import type { ExtractionTask } from '../runner.ts';
import { buildContextV2, type PromptVersion, type Selection } from './context.ts';
import {
  extractionV2InputSchema,
  extractionV2Schema,
  type ExtractionV2,
  type ExtractionV2Input,
} from './schema.ts';
import { validateExtractionV2, validateInputsV2 } from './validate.ts';

/** Four captured pages at the schema's 400 kB body limit, with JSON framing. */
export const MAX_INPUT_BYTES_V2 = 1_500_000;

/** The v2 issuer extraction as a runner task, with the prompt and source selection under test bound in. */
export function extractionTaskV2(
  prompt: PromptVersion,
  selection: Selection,
): ExtractionTask<ExtractionV2Input, ExtractionV2> {
  return {
    parseInput: (raw) => extractionV2InputSchema.safeParse(raw),
    validateInputs: (input) => validateInputsV2(input),
    documents: (input) =>
      input.documents.map((document) => ({ id: document.id, contentHash: document.contentHash })),
    buildContext: (input) => buildContextV2(input, prompt, selection),
    maxInputBytes: MAX_INPUT_BYTES_V2,
    outputSchema: extractionV2Schema,
    validateOutput: validateExtractionV2,
  };
}
