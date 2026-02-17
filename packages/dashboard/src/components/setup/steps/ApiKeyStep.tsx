export function ApiKeyStep() {
  return (
    <div>
      <h2 className="text-xl font-semibold text-white">Encryption Secret</h2>
      <p className="mt-3 text-gray-400 leading-relaxed">
        Sonde uses the{' '}
        <code className="text-gray-300 bg-gray-800 px-1.5 py-0.5 rounded text-sm">
          SONDE_SECRET
        </code>{' '}
        environment variable to encrypt integration credentials at rest. This is separate from API
        keys, which are managed from the dashboard.
      </p>
      <div className="mt-4 rounded-lg bg-gray-800 p-4">
        <p className="text-sm text-gray-300 font-mono">SONDE_SECRET=$(openssl rand -hex 32)</p>
      </div>
      <p className="mt-3 text-sm text-gray-500">
        Set this variable before starting the hub. Generate a random hex string (at least 16
        characters). An admin API key will be auto-generated when you complete setup.
      </p>
    </div>
  );
}
