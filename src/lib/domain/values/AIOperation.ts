/**
 * AIOperation — domain enum for the kinds of AI text transformations
 * the app supports. Lives in the domain (not in any port) so both
 * inbound and outbound ports can reference it without one depending on
 * the other.
 */

export type AIOperation =
  | 'rewrite'
  | 'expand'
  | 'summarize'
  | 'fix-grammar'
  | 'translate'
  | 'custom';
