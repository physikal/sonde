import { useState } from 'react';
import { AgentEnrollStep } from './steps/AgentEnrollStep';
import { AiToolsStep } from './steps/AiToolsStep';
import { ApiKeyStep } from './steps/ApiKeyStep';
import { CompleteStep } from './steps/CompleteStep';
import { WelcomeStep } from './steps/WelcomeStep';

const STEP_LABELS = ['Welcome', 'API Key', 'AI Tools', 'Agent', 'Complete'];

interface SetupWizardProps {
  onComplete: () => void;
}

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);

  const next = () => setCurrentStep((s) => Math.min(s + 1, STEP_LABELS.length - 1));
  const back = () => setCurrentStep((s) => Math.max(s - 1, 0));

  return (
    <div className="flex min-h-screen flex-col items-center bg-gray-950 px-4 py-12">
      <div className="w-full max-w-2xl">
        {/* Step indicator */}
        <div className="mb-10 flex items-center justify-center gap-2">
          {STEP_LABELS.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                  i <= currentStep ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-500'
                }`}
              >
                {i + 1}
              </div>
              <span className={`text-xs ${i <= currentStep ? 'text-gray-200' : 'text-gray-600'}`}>
                {label}
              </span>
              {i < STEP_LABELS.length - 1 && (
                <div className={`h-px w-8 ${i < currentStep ? 'bg-blue-600' : 'bg-gray-800'}`} />
              )}
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-8">
          {currentStep === 0 && <WelcomeStep />}
          {currentStep === 1 && <ApiKeyStep />}
          {currentStep === 2 && <AiToolsStep />}
          {currentStep === 3 && <AgentEnrollStep />}
          {currentStep === 4 && <CompleteStep onComplete={onComplete} />}
        </div>

        {/* Navigation */}
        <div className="mt-6 flex justify-between">
          <button
            type="button"
            onClick={back}
            disabled={currentStep === 0}
            className="rounded-md px-4 py-2 text-sm font-medium text-gray-400 hover:text-white disabled:invisible"
          >
            Back
          </button>
          {currentStep < STEP_LABELS.length - 1 && (
            <button
              type="button"
              onClick={next}
              className="rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-500"
            >
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
