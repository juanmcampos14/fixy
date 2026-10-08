export type ActionState = {
  ok?: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  data?: Record<string, unknown>;
};
export const initialActionState: ActionState = {};
