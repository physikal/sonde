import crypto from 'node:crypto';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { SondeDb } from '../db/index.js';
import { decrypt } from '../integrations/crypto.js';
import { resolveHighestRole } from './roles.js';
import { SESSION_COOKIE } from './session-middleware.js';
import type { SessionManager } from './sessions.js';

const STATE_COOKIE = 'entra_state';
const STATE_MAX_AGE = 600; // 10 minutes

interface EntraAuthConfig {
  secret: string;
  hubUrl: string;
}

/** Exported for testing — allows injection of fetch function. */
export type FetchFn = typeof globalThis.fetch;

export function createEntraRoutes(
  sessionManager: SessionManager,
  db: SondeDb,
  config: EntraAuthConfig,
  fetchFn?: FetchFn,
): Hono {
  const entra = new Hono();
  const doFetch = fetchFn ?? globalThis.fetch;

  // GET /auth/entra/login — redirect to Entra authorize endpoint
  entra.get('/entra/login', (c) => {
    const ssoConfig = db.getSsoConfig();
    if (!ssoConfig || !ssoConfig.enabled) {
      return c.json({ error: 'SSO is not configured or disabled' }, 404);
    }

    const state = crypto.randomBytes(16).toString('hex');

    setCookie(c, STATE_COOKIE, state, {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: STATE_MAX_AGE,
    });

    // Dynamic scope: include GroupMember.Read.All only when authorized_groups has rows
    const hasGroups = db.countAuthorizedGroups() > 0;
    const scope = hasGroups
      ? 'openid email profile User.Read GroupMember.Read.All'
      : 'openid email profile';

    const redirectUri = `${config.hubUrl}/auth/entra/callback`;
    const params = new URLSearchParams({
      client_id: ssoConfig.clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope,
      state,
    });

    const authorizeUrl = `https://login.microsoftonline.com/${ssoConfig.tenantId}/oauth2/v2.0/authorize?${params.toString()}`;
    return c.redirect(authorizeUrl, 302);
  });

  // GET /auth/entra/callback — exchange code for tokens, dual authorization
  entra.get('/entra/callback', async (c) => {
    const ssoConfig = db.getSsoConfig();
    if (!ssoConfig || !ssoConfig.enabled) {
      return c.json({ error: 'SSO is not configured or disabled' }, 404);
    }

    // Validate state
    const stateCookie = getCookie(c, STATE_COOKIE);
    const stateParam = c.req.query('state');
    deleteCookie(c, STATE_COOKIE, { path: '/' });

    if (!stateCookie || !stateParam || stateCookie !== stateParam) {
      return c.redirect('/login?error=state_mismatch', 302);
    }

    const code = c.req.query('code');
    if (!code) {
      return c.redirect('/login?error=no_code', 302);
    }

    // Exchange code for tokens
    let clientSecret: string;
    try {
      clientSecret = decrypt(ssoConfig.clientSecretEnc, config.secret);
    } catch {
      return c.redirect('/login?error=config_error', 302);
    }

    const redirectUri = `${config.hubUrl}/auth/entra/callback`;
    const tokenUrl = `https://login.microsoftonline.com/${ssoConfig.tenantId}/oauth2/v2.0/token`;

    const tokenBody = new URLSearchParams({
      client_id: ssoConfig.clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });

    let tokenResponse: Response;
    try {
      tokenResponse = await doFetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenBody.toString(),
      });
    } catch {
      return c.redirect('/login?error=token_exchange_failed', 302);
    }

    if (!tokenResponse.ok) {
      return c.redirect('/login?error=token_exchange_failed', 302);
    }

    const tokenData = (await tokenResponse.json()) as {
      id_token?: string;
      access_token?: string;
    };
    if (!tokenData.id_token) {
      return c.redirect('/login?error=no_id_token', 302);
    }

    // Decode ID token payload
    const parts = tokenData.id_token.split('.');
    if (parts.length !== 3) {
      return c.redirect('/login?error=invalid_token', 302);
    }

    let claims: { preferred_username?: string; email?: string; name?: string; oid?: string };
    try {
      const payload = parts[1];
      if (!payload) {
        return c.redirect('/login?error=invalid_token', 302);
      }
      claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      return c.redirect('/login?error=invalid_token', 302);
    }

    const email = claims.preferred_username ?? claims.email;
    if (!email) {
      return c.redirect('/login?error=no_email', 302);
    }

    const oid = claims.oid;
    const displayName = claims.name ?? email;

    // --- Dual authorization ---

    // 1. Check individual authorization (by oid first, then email fallback)
    let userRole: string | undefined;
    let authorizedUser = oid ? db.getAuthorizedUserByOid(oid) : undefined;

    if (!authorizedUser) {
      authorizedUser = db.getAuthorizedUserByEmail(email);
    }

    if (authorizedUser) {
      if (!authorizedUser.enabled) {
        // Disabled user treated as not found for auth purposes
        authorizedUser = undefined;
      } else {
        userRole = authorizedUser.roleId;

        // Backfill oid if user was matched by email but has no oid
        if (oid && !authorizedUser.entraObjectId) {
          db.updateAuthorizedUserLogin(authorizedUser.id, {
            displayName,
            entraObjectId: oid,
          });
        }
      }
    }

    // 2. Conditional group check (only if authorized_groups has rows)
    let groupRole: string | undefined;
    const groupCount = db.countAuthorizedGroups();

    if (groupCount > 0 && tokenData.access_token) {
      try {
        const graphResponse = await doFetch(
          'https://graph.microsoft.com/v1.0/me/memberOf?$select=id,displayName',
          {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
          },
        );

        if (graphResponse.ok) {
          const graphData = (await graphResponse.json()) as {
            value?: Array<{ id?: string; displayName?: string }>;
          };

          const memberGroupIds = (graphData.value ?? [])
            .filter((g) => g.id)
            .map((g) => g.id as string);

          // Match against authorized_groups
          for (const groupId of memberGroupIds) {
            const authGroup = db.getAuthorizedGroupByEntraId(groupId);
            if (authGroup) {
              groupRole = resolveHighestRole(groupRole, authGroup.roleId) ?? groupRole;
            }
          }
        }
        // Graph API failure is non-fatal — if user is individually authorized, login still succeeds
      } catch {
        // Graph API error — non-fatal
      }
    }

    // 3. Resolve final role: highest of individual and group
    const finalRole = resolveHighestRole(userRole, groupRole);

    if (!finalRole) {
      return c.redirect('/login?error=unauthorized', 302);
    }

    // 4. Auto-create authorized_users row for group-only users
    if (!authorizedUser && groupRole) {
      const newId = crypto.randomUUID();
      db.createAuthorizedUser(newId, email, finalRole, {
        displayName,
        entraObjectId: oid,
        createdBy: 'auto:entra_group',
      });
      authorizedUser = db.getAuthorizedUserByEmail(email);
    }

    // 5. Update login audit
    if (authorizedUser) {
      db.updateAuthorizedUserLogin(authorizedUser.id, {
        displayName,
        entraObjectId: oid,
      });
    }

    // 6. Create session with resolved role
    const userId = oid ?? `entra:${email}`;
    const sessionId = sessionManager.createSession({
      authMethod: 'entra',
      userId,
      email,
      displayName,
      role: finalRole,
    });

    setCookie(c, SESSION_COOKIE, sessionId, {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: 8 * 60 * 60, // 8 hours
    });

    return c.redirect('/', 302);
  });

  return entra;
}
