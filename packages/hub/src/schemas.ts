import { z } from 'zod';

const RoleSchema = z.enum(['member', 'admin', 'owner']);
const AuthMethodSchema = z.enum(['api_key', 'bearer_token', 'oauth2']);

// --- API Keys ---

export const CreateApiKeyBody = z.object({
  name: z.string().min(1, 'name is required'),
  policy: z.record(z.unknown()).optional(),
  role: RoleSchema.default('member'),
});

export const UpdateApiKeyPolicyBody = z.object({
  policy: z.record(z.unknown()).default({}),
});

// --- SSO / Entra ---

export const CreateSsoBody = z.object({
  tenantId: z.string().min(1, 'tenantId is required'),
  clientId: z.string().min(1, 'clientId is required'),
  clientSecret: z.string().min(1, 'clientSecret is required'),
  enabled: z.boolean().default(true),
});

export const UpdateSsoBody = z.object({
  tenantId: z.string().min(1).optional(),
  clientId: z.string().min(1).optional(),
  clientSecret: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});

// --- Authorized Users ---

export const CreateAuthorizedUserBody = z.object({
  email: z.string().min(1, 'email is required'),
  role: RoleSchema.default('member'),
});

export const UpdateAuthorizedUserBody = z
  .object({
    role: RoleSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .refine((d) => d.role !== undefined || d.enabled !== undefined, {
    message: 'role or enabled is required',
  });

// --- Authorized Groups ---

export const CreateAuthorizedGroupBody = z.object({
  entraGroupId: z.string().min(1, 'entraGroupId is required'),
  entraGroupName: z.string().default(''),
  role: RoleSchema.default('member'),
});

export const UpdateAuthorizedGroupBody = z.object({
  role: RoleSchema,
});

// --- Access Groups ---

export const CreateAccessGroupBody = z.object({
  name: z.string().min(1, 'name is required'),
  description: z.string().default(''),
});

export const UpdateAccessGroupBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
});

export const AccessGroupAgentBody = z.object({
  pattern: z.string().min(1, 'pattern is required'),
});

export const AccessGroupIntegrationBody = z.object({
  integrationId: z.string().min(1, 'integrationId is required'),
});

export const AccessGroupUserBody = z.object({
  userId: z.string().min(1, 'userId is required'),
});

// --- Integrations ---

export const ActivateGraphBody = z.object({
  name: z
    .string()
    .min(1, 'name is required')
    .transform((s) => s.trim()),
});

const OAuth2Schema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  expiresAt: z.number().optional(),
  tokenUrl: z.string().optional(),
});

const CredentialsSchema = z.object({
  packName: z.string(),
  authMethod: AuthMethodSchema,
  credentials: z.record(z.string()),
  oauth2: OAuth2Schema.optional(),
});

export const CreateIntegrationBody = z.object({
  type: z.string().min(1, 'type is required'),
  name: z.string().min(1, 'name is required'),
  config: z.object({
    endpoint: z.string(),
    headers: z.record(z.string()).optional(),
    tlsRejectUnauthorized: z.boolean().optional(),
  }),
  credentials: CredentialsSchema,
});

export const UpdateIntegrationBody = z.object({
  config: z
    .object({
      endpoint: z.string(),
      headers: z.record(z.string()).optional(),
      tlsRejectUnauthorized: z.boolean().optional(),
    })
    .optional(),
  credentials: CredentialsSchema.optional(),
});

// --- Tags ---

export const SetTagsBody = z.object({
  tags: z.array(z.string().min(1)).max(50),
});

export const BulkTagsBody = z
  .object({
    ids: z.array(z.string().min(1)).min(1),
    add: z.array(z.string().min(1)).optional(),
    remove: z.array(z.string().min(1)).optional(),
  })
  .refine((d) => (d.add && d.add.length > 0) || (d.remove && d.remove.length > 0), {
    message: 'add or remove is required',
  });

export const TagImportBody = z.object({
  type: z.enum(['agent', 'integration']),
  entries: z.array(
    z.object({
      name: z.string().min(1),
      tags: z.array(z.string().min(1)),
    }),
  ),
});

// --- Probes / Diagnostics ---
// Reuse ProbeInput and DiagnoseInput from @sonde/shared (exported via mcp.ts)

// --- Validation helper ---

export function parseBody<S extends z.ZodTypeAny>(
  schema: S,
  data: unknown,
): { success: true; data: z.output<S> } | { success: false; error: string } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const firstIssue = result.error.issues[0];
  const message = firstIssue
    ? firstIssue.message === 'Required'
      ? `${String(firstIssue.path[0] ?? 'field')} is required`
      : firstIssue.message
    : 'Invalid input';
  return { success: false, error: message };
}
