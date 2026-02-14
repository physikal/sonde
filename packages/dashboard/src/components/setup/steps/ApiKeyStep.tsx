export function ApiKeyStep() {
  return (
    <div>
      <h2 className="text-xl font-semibold text-white">API Key</h2>
      <p className="mt-3 text-gray-400 leading-relaxed">
        Sonde uses the{' '}
        <code className="text-gray-300 bg-gray-800 px-1.5 py-0.5 rounded text-sm">
          SONDE_API_KEY
        </code>{' '}
        environment variable to authenticate requests to the hub.
      </p>
      <div className="mt-4 rounded-lg bg-gray-800 p-4">
        <p className="text-sm text-gray-300 font-mono">SONDE_API_KEY=your-secret-key-here</p>
      </div>
      <p className="mt-3 text-sm text-gray-500">
        Set this variable before starting the hub. It is used for agent enrollment, API key
        management, and MCP authentication.
      </p>
    </div>
  );
}
