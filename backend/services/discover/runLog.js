/**
 * What a Discover run says, kept with its slot for the page and the Jobs page (a run was a child process with its own
 * stdout before it came into the app). Anything called during a run reaches the slot through AsyncLocalStorage; outside a
 * run (an upload's judging) the lines go to the server's log.
 */
const { AsyncLocalStorage } = require('async_hooks');

const MAX_LINES = 400;
const context = new AsyncLocalStorage();

function write(line, fallback) {
  const slot = context.getStore();
  if (!slot) return fallback(line);
  slot.log.push(...String(line).split(/\r?\n/).filter(Boolean));
  if (slot.log.length > MAX_LINES) slot.log.splice(0, slot.log.length - MAX_LINES);
}

const say = (line) => write(line, console.log);
const warn = (line) => write(line, console.warn);

/** fn() as the slot's run */
const inRun = (slot, fn) => context.run(slot, fn);

/** Whether Pause was pressed on this run: it stops between two posts, so a post is never left half done */
const stopped = () => !!context.getStore()?.stopRequested;

module.exports = { say, warn, inRun, stopped };
