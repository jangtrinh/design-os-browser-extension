import { dispatchCli } from './commands/dispatch.js';

void dispatchCli(process.argv.slice(2)).then((code) => {
  if (code >= 0) {
    process.exitCode = code;
  }
});
