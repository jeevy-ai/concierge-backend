interface Window {
  posthog?: {
    people?: {
      set_once?: (props: Record<string, unknown>) => void;
      set?: (props: Record<string, unknown>) => void;
    };
  };
}
