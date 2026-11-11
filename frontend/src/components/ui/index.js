/**
 * The one dialog and toast system of the app. <FeedbackProvider> is mounted once in App.js (and
 * <CloseAsksOnRouteChange /> inside its Router, so a question never outlives its page); everything else imports
 * from here (src/pages/* and src/utils/*: '../components/ui'; src/components/*: './ui'; src/components/<sub>/*: '../ui').
 *
 * How to choose:
 *   - The action can be undone (an undo endpoint exists): act at once, then notify({ message, action: { label: 'Undo', onClick } }).
 *   - It cannot be undone, or it loses data: ask() first. okLabel = verb + object ('Delete 12 files'), danger when data
 *     is lost, typeToConfirm only for the very destructive ones. A long action goes in run, so its error shows inline.
 *   - A question with a text answer: ask({ input: { label, value, validate } }).
 *   - Anything bigger than a question (a form, a picker): <AppDialog>.
 *   - Errors: inline in the open dialog (AppDialog error, or a throw in ask's run); with no dialog open, an error toast.
 *   - Success: a toast after the dialog closed, or when the result is not visible where the user looks.
 * Words: plain short English, sentence case, no exclamation marks, no emoji, no 'Successfully', no 'Error:' prefix.
 *
 * API
 *   const notify = useNotify();   // stable
 *   const close = notify({ message, severity = 'success' | 'info' | 'warning' | 'error', action: { label, onClick }, duration });
 *     duration: ms or null (stays). Default: success/info 5000, 8000 with an action; warning/error null.
 *     One toast at a time: a new one replaces the shown one. An action click closes the toast, then runs onClick.
 *     close() closes this toast if it is still shown. notify('Saved') = { message: 'Saved', severity: 'success' }.
 *   useToastLift(bottom);         // CSS length | { xs, sm, md, lg } | null: while mounted, toasts sit at that bottom.
 *                                  // On the phone shell, add var(--nav-bottom, 0px) to clear the bottom navigation.
 *   const ask = useAsk();         // stable
 *   await ask({ title, text, rows, okLabel, danger, typeToConfirm,
 *               input: { label, value, placeholder, multiline, validate: (v) => string | null, allowEmpty },
 *               alt: { label, value, danger }, run: async (answer) => {}, busyLabel = 'Working…',
 *               cancelLabel = 'Cancel', cancelFocus = danger, size = 'sm' | 'md' })
 *     -> confirm: true | false; input: the trimmed string | null; alt clicked: alt.value. With run the dialog stays
 *        open showing busyLabel until run succeeds; a throw shows errorText(err) inline. Calls while one is open wait.
 *        The action button stays disabled while validate returns a string or the answer is empty (allowEmpty: true
 *        lets an empty answer through, as '').
 *   <AppDialog open onClose title subtitle size="sm|md|lg" sheet busy error
 *     primary={{ label, onClick, danger, disabled, busyLabel }} secondary={[{ label, onClick, danger, disabled }]}
 *     footer cancelLabel="Cancel" onSubmit persistent autoFocus="primary|cancel">…</AppDialog>
 *     With onSubmit the dialog is a <form>: Enter submits and the primary is its submit button (onSubmit runs, not
 *     primary.onClick).
 *   <DialogText>…</DialogText>   <FactRows rows={[['Folder', path]]} />
 *   errorText(err, fallback = 'It did not work')   plural(n, word, many = word + 's')
 */
export { default as AppDialog, DialogText, FactRows, dialogContainer } from './AppDialog';
export { FeedbackProvider, CloseAsksOnRouteChange, useAsk, useNotify, useToastLift, errorText, plural } from './feedback';
