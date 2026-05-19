import { defineTool } from '../define';

interface PlanStep {
  description: string;
  tools: string[];
  notes?: string[];
}

interface PlanArgs {
  summary: string;
  steps: PlanStep[];
}

interface PlanResult {
  approved: boolean;
  stepCount: number;
}

export default defineTool<PlanArgs, PlanResult>({
  id: 'ai:plan',
  name: 'Declare Plan',
  description: 'Declare a multi-step plan before executing it. Use this when you need to perform multiple operations across notes. The plan is shown to the user for review before proceeding.',
  category: 'ai',

  args: {
    summary: {
      type: 'string',
      description: 'Brief summary of what the plan will accomplish',
      required: true,
    },
    steps: {
      type: 'array',
      description: 'Ordered list of steps to execute',
      required: true,
      items: {
        type: 'object',
        description: 'A single step in the plan',
        properties: {
          description: { type: 'string', description: 'What this step does' },
          tools: { type: 'array', description: 'Tool IDs this step will use', items: { type: 'string', description: 'Tool ID' } },
          notes: { type: 'array', description: 'Notes this step affects', items: { type: 'string', description: 'Note path' } },
        },
      },
    },
  },

  keywords: ['plan', 'strategy', 'steps', 'batch', 'multi-step'],
  examples: [
    'Plan to reorganize notes by topic',
    'Plan to tag all project-related notes',
  ],
  accessMode: 'read',

  summary: (args) => `Plan: ${args.summary} (${args.steps.length} steps)`,

  async execute(args) {
    // The plan tool itself just validates and returns the plan structure.
    // The actual approval flow is handled by the AgentLoopService
    // when it detects this tool was called.
    return {
      approved: true,
      stepCount: args.steps.length,
    };
  },
});
