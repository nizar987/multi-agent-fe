/** Shared memory + audit trail (PRD 6.7). */
import { getDb } from "./db";

export function memoryList() {
  return getDb().prepare("SELECT * FROM memories ORDER BY updated_at DESC").all();
}

export function memoryAuditList(limit = 200) {
  return getDb()
    .prepare("SELECT * FROM memory_audit ORDER BY id DESC LIMIT ?")
    .all(limit);
}

function audit(agentId: number | null, agentName: string, action: string, key: string, value?: string) {
  getDb()
    .prepare("INSERT INTO memory_audit(agent_id,agent_name,action,key,value_preview) VALUES(?,?,?,?,?)")
    .run(agentId, agentName, action, key, value ? value.slice(0, 120) : null);
}

export function memoryRead(key: string, agentId: number | null, agentName: string): string | null {
  const row = getDb().prepare("SELECT value FROM memories WHERE key=?").get(key) as any;
  audit(agentId, agentName, "read", key, row?.value);
  return row?.value ?? null;
}

export function memoryWrite(key: string, value: string, agentId: number | null, agentName: string) {
  getDb()
    .prepare(`INSERT INTO memories(key,value,updated_by_agent) VALUES(?,?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,
        updated_by_agent=excluded.updated_by_agent, updated_at=datetime('now')`)
    .run(key, value, agentId);
  audit(agentId, agentName, "write", key, value);
}

export function memoryDelete(key: string, agentId: number | null, agentName: string) {
  getDb().prepare("DELETE FROM memories WHERE key=?").run(key);
  audit(agentId, agentName, "delete", key);
}
