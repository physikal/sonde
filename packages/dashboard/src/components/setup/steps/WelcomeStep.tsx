export function WelcomeStep() {
  return (
    <div>
      <h2 className="text-xl font-semibold text-white">Welcome to Sonde</h2>
      <p className="mt-3 text-gray-400 leading-relaxed">
        Sonde is an AI infrastructure agent that lets AI assistants like Claude gather real-time
        information from your servers for troubleshooting and monitoring.
      </p>
      <p className="mt-3 text-gray-400 leading-relaxed">
        This wizard will walk you through the initial setup:
      </p>
      <ul className="mt-3 space-y-2 text-sm text-gray-400">
        <li className="flex gap-2">
          <span className="text-blue-400">1.</span> Configure your API key
        </li>
        <li className="flex gap-2">
          <span className="text-blue-400">2.</span> Connect your AI tools via MCP
        </li>
        <li className="flex gap-2">
          <span className="text-blue-400">3.</span> Enroll your first agent
        </li>
      </ul>
    </div>
  );
}
