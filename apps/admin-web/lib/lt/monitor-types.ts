export type OperationsSnapshot = {
  checkedAt: number;
  maintenance: { status: "ok" | "disabled" | "stale" | "failed"; enabled: boolean; heartbeat: { startedAt: number | null; completedAt: number | null; succeededAt: number | null; outcome: string } };
  mail: { mode: string; configured: boolean; testRecipientOnly: boolean; states: { state: string; count: number }[]; backlog: { count: number; oldestAt: number | null } };
  items: { key: string; eventId: string; title: string; applicationId: string | null; reason: "withdrawal" | "vacancy" | "material" }[];
};

export type PushSettings = {
  enabled: boolean;
  registered: boolean;
  failures: number;
  publicKey: string | null;
  userId: string;
  status: { checked_at: number | null; outcome: string } | null;
};
