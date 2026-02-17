import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

export default defineConfig({
  integrations: [
    starlight({
      title: 'Sonde',
      description: 'AI infrastructure agent — give Claude eyes into your servers.',
      social: {
        github: 'https://github.com/sonde-dev/sonde',
      },
      sidebar: [
        { label: 'Getting Started', slug: 'getting-started' },
        {
          label: 'Hub',
          items: [
            { label: 'Deployment', slug: 'hub/deployment' },
            { label: 'Configuration', slug: 'hub/configuration' },
            { label: 'Docker', slug: 'hub/docker' },
          ],
        },
        {
          label: 'Agent',
          items: [
            { label: 'Installation', slug: 'agent/installation' },
            { label: 'Enrollment', slug: 'agent/enrollment' },
            { label: 'CLI Reference', slug: 'agent/cli' },
            { label: 'MCP Bridge', slug: 'agent/mcp-bridge' },
          ],
        },
        {
          label: 'Packs',
          items: [
            { label: 'Overview', slug: 'packs/overview' },
            { label: 'System', slug: 'packs/system' },
            { label: 'Docker', slug: 'packs/docker' },
            { label: 'systemd', slug: 'packs/systemd' },
            { label: 'Nginx', slug: 'packs/nginx' },
            { label: 'PostgreSQL', slug: 'packs/postgres' },
            { label: 'Redis', slug: 'packs/redis' },
            { label: 'MySQL', slug: 'packs/mysql' },
            { label: 'Creating a Pack', slug: 'packs/creating' },
          ],
        },
        {
          label: 'AI Integration',
          items: [
            { label: 'Claude Desktop', slug: 'ai/claude-desktop' },
            { label: 'Claude Code', slug: 'ai/claude-code' },
            { label: 'Other MCP Clients', slug: 'ai/other-clients' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Architecture', slug: 'reference/architecture' },
            { label: 'Protocol', slug: 'reference/protocol' },
            { label: 'Security Model', slug: 'reference/security' },
            { label: 'API Reference', slug: 'reference/api' },
          ],
        },
      ],
    }),
  ],
});
