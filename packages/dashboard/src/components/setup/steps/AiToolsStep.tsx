import { useState } from 'react';

export function AiToolsStep() {
  const mcpUrl = `${window.location.origin}/mcp`;
  const [copied, setCopied] = useState(false);

  const copyUrl = () => {
    navigator.clipboard.writeText(mcpUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div>
      <h2 className="text-xl font-semibold text-white">Connect AI Tools</h2>
      <p className="mt-3 text-gray-400 leading-relaxed">
        Add Sonde as an MCP server in your AI tool (Claude Desktop, Claude Code, etc.).
      </p>

      <div className="mt-4">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">MCP Server URL</p>
        <div className="mt-1 flex items-center gap-2">
          <code className="flex-1 rounded-lg bg-gray-800 px-4 py-2.5 text-sm text-gray-200 font-mono">
            {mcpUrl}
          </code>
          <button
            type="button"
            onClick={copyUrl}
            className="rounded-md bg-gray-800 px-3 py-2.5 text-sm text-gray-300 hover:bg-gray-700"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      <div className="mt-5 rounded-lg bg-gray-800 p-4">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
          Claude Desktop config example
        </p>
        <pre className="text-sm text-gray-300 font-mono whitespace-pre-wrap">{`{
  "mcpServers": {
    "sonde": {
      "url": "${mcpUrl}",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}`}</pre>
      </div>
    </div>
  );
}
