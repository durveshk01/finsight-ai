import { apiRequest, ApiError } from "../src/services/api";
import { MobileStorage } from "../src/services/storage";
import { MobileSyncService } from "../src/services/sync";
import { addMutation } from "../src/services/workspace";
import { SyncPullResponse } from "../src/types";
import { mutation, session, transaction } from "./fixtures";

jest.mock("../src/services/api", () => ({ ...jest.requireActual("../src/services/api"), apiRequest: jest.fn() }));
const request = jest.mocked(apiRequest);
const current = session(true);
const baseline = (overrides: Partial<SyncPullResponse> = {}): SyncPullResponse => ({ protocol_version: 2, mode: "baseline", latest_seq: 0, has_more: false, role: "owner", business: current.business, data: { transactions: [], accounts: [], invoices: [] }, ...overrides });
beforeEach(() => { request.mockReset(); });
const queueOne = () => MobileStorage.updateWorkspace(current, (data) => addMutation(data, mutation(-1), true));

test("device-only mode never calls the API or reports cloud success", async () => {
  const result = await new MobileSyncService().sync(session());
  expect(result.success).toBe(false);
  expect(result.error).toMatch(/device-only/);
  expect(request).not.toHaveBeenCalled();
});

test("successful saves acknowledge full records before pulling and retain the server cursor", async () => {
  await queueOne();
  request.mockResolvedValueOnce({ applied: [{ client_mutation_id: "mutation-1", entity_id: 22, record: transaction({ id: 22 }) }], conflicts: [] });
  request.mockResolvedValueOnce(baseline({ latest_seq: 1, data: { transactions: [transaction({ id: 22 })], accounts: [], invoices: [] } }));
  const result = await new MobileSyncService().sync(current);
  expect(result).toMatchObject({ success: true, pushed: 1, role: "owner" });
  const saved = await MobileStorage.getWorkspace(current);
  expect(saved.queue).toHaveLength(0);
  expect(saved.snapshot.transactions).toHaveLength(1);
  expect(saved.sync).toMatchObject({ latestSeq: 1, lastError: null });
  expect(saved.sync.lastSyncTime).not.toBeNull();
});

test("a conflicting change stays queued while the cloud snapshot still refreshes", async () => {
  await queueOne();
  request.mockResolvedValueOnce({ applied: [], conflicts: [{ client_mutation_id: "mutation-1", error: "Invoice changed" }] });
  request.mockResolvedValueOnce(baseline());
  expect(await new MobileSyncService().sync(current)).toMatchObject({ success: false, error: "Invoice changed" });
  expect((await MobileStorage.getWorkspace(current)).queue[0]).toMatchObject({ client_mutation_id: "mutation-1", error: "Invoice changed" });
});

test("revoked write access refreshes viewer permissions without discarding pending financial changes", async () => {
  await queueOne();
  request.mockRejectedValueOnce(new ApiError("Read-only workspace", 403));
  request.mockResolvedValueOnce(baseline({ role: "viewer" }));
  expect(await new MobileSyncService().sync(current)).toMatchObject({ success: false, role: "viewer", error: "Read-only workspace" });
  expect(request.mock.calls[1][1]).toBe("/api/sync/pull");
  expect((await MobileStorage.getWorkspace(current)).queue).toHaveLength(1);
});

test("expired tokens request sign-in and retain retry identifiers", async () => {
  await queueOne();
  request.mockRejectedValueOnce(new ApiError("Session expired", 401));
  expect(await new MobileSyncService().sync(current)).toMatchObject({ success: false, needsSignIn: true });
  expect((await MobileStorage.getWorkspace(current)).queue[0].client_mutation_id).toBe("mutation-1");
});

test("incomplete acknowledgements cannot erase a payment", async () => {
  await MobileStorage.updateWorkspace(current, (data) => addMutation(data, mutation(-1, { entity_type: "payment", data: { invoice_id: 11, amount: 40 } }), true));
  request.mockResolvedValueOnce({ applied: [{ client_mutation_id: "mutation-1", entity_id: 22 }], conflicts: [] });
  expect((await new MobileSyncService().sync(current)).success).toBe(false);
  expect((await MobileStorage.getWorkspace(current)).queue).toHaveLength(1);
});

test.each([baseline({ protocol_version: 1 } as unknown as Partial<SyncPullResponse>), baseline({ business: { ...current.business, id: 99 } }), baseline({ data: undefined })])("incompatible or wrong-tenant snapshots never replace cached data", async (response) => {
  request.mockResolvedValueOnce(response);
  expect(await new MobileSyncService().sync(current)).toMatchObject({ success: false, error: expect.stringContaining("incompatible") });
  const saved = await MobileStorage.getWorkspace(current);
  expect(saved.snapshot.business.id).toBe(current.business.id);
  expect(saved.sync.latestSeq).toBe(0);
});

test("paginated pulls advance using new_seq rather than skipping to the latest watermark", async () => {
  await MobileStorage.updateWorkspace(current, (data) => ({ ...data, sync: { ...data.sync, latestSeq: 1 } }));
  request.mockResolvedValueOnce(baseline({ mode: "delta", latest_seq: 5, new_seq: 3, has_more: true, changes: [{ seq_num: 3, entity_type: "transaction", entity_id: 3, action: "create", data: { ...transaction({ id: 3 }) } }] }));
  request.mockResolvedValueOnce(baseline({ mode: "delta", latest_seq: 5, new_seq: 5, changes: [{ seq_num: 5, entity_type: "transaction", entity_id: 5, action: "create", data: { ...transaction({ id: 5 }) } }] }));
  expect((await new MobileSyncService().sync(current)).success).toBe(true);
  expect(request.mock.calls.map((call) => call[2])).toEqual([{ since_seq: 1, limit: 200 }, { since_seq: 3, limit: 200 }]);
  expect((await MobileStorage.getWorkspace(current)).snapshot.transactions.map((row) => row.id)).toEqual([3, 5]);
});

test("two sync attempts for one workspace cannot post in parallel", async () => {
  let resolve!: (value: SyncPullResponse) => void;
  request.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const service = new MobileSyncService();
  const first = service.sync(current);
  expect(await service.sync(current)).toMatchObject({ success: false, error: expect.stringContaining("already running") });
  await new Promise((done) => setImmediate(done));
  resolve(baseline());
  expect((await first).success).toBe(true);
  expect(request).toHaveBeenCalledTimes(1);
});
