import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({
  absWorkingDir: root,
  entryPoints: ['apps/api/src/curation/eval-cli.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { runEvaluationCli } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);
try {
  await runEvaluationCli(process.argv.slice(2), root);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Evaluation failed.');
  process.exitCode = 1;
}
