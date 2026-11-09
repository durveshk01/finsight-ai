import { acknowledgeMutation, addMutation, applyPull, emptyWorkspace, materializeWorkspace } from "../src/services/workspace";
import { account, invoice, mutation, session, transaction } from "./fixtures";

test("local entries persist in the snapshot while cloud entries remain optimistic queued drafts", () => {
  const local = addMutation(emptyWorkspace(session()), mutation(-1), false);
  expect(local.queue).toHaveLength(0);
  expect(local.snapshot.transactions[0]).toMatchObject({ id: -1, is_offline_draft: false });
  const cloud = addMutation(emptyWorkspace(session(true)), mutation(-1), true);
  expect(cloud.snapshot.transactions).toHaveLength(0);
  expect(materializeWorkspace(cloud).transactions[0]).toMatchObject({ id: -1, is_offline_draft: true });
});

test("acknowledgements remap dependent accounts, invoices, payments and subsequent edits", () => {
  let data = emptyWorkspace(session(true));
  data = addMutation(data, mutation(-1, { entity_type: "account", data: { ...account(), id: undefined } }), true);
  data = addMutation(data, mutation(-2, { entity_type: "invoice", data: { ...invoice(), account_id: -1, id: undefined } }), true);
  data = addMutation(data, mutation(-3, { entity_type: "payment", data: { invoice_id: -2, account_id: -1, amount: 40, paid_on: "2025-01-31", payment_method: "Bank" } }), true);
  expect(materializeWorkspace(data).invoices[0].amount_due).toBe(60);
  data = acknowledgeMutation(data, { client_mutation_id: "mutation-1", entity_id: 101, record: { ...account(), id: 101 } });
  expect(data.queue[0].data.account_id).toBe(101);
  expect(data.queue[1].data.account_id).toBe(101);
  data = acknowledgeMutation(data, { client_mutation_id: "mutation-2", entity_id: 202, record: { ...invoice(), id: 202, account_id: 101 } });
  expect(data.queue[0].data.invoice_id).toBe(202);
  data = acknowledgeMutation(data, { client_mutation_id: "mutation-3", entity_id: 999, invoice: invoice({ id: 202, account_id: 101, amount_paid: 40, amount_due: 60 }), transaction: transaction({ id: 303, amount: 40, account_id: 101, invoice_id: 202 }) });
  expect(data.queue).toHaveLength(0);
  expect(materializeWorkspace(data).invoices[0].amount_due).toBe(60);
  expect(data.snapshot.transactions).toHaveLength(1);
  expect(data.snapshot.transactions[0]).toMatchObject({ id: 303, invoice_id: 202, amount: 40 });
});

test("a queued edit follows its draft create to the acknowledged server ID", () => {
  let data = addMutation(emptyWorkspace(session(true)), mutation(-1), true);
  data = addMutation(data, mutation(-2, { entity_id: -1, action: "update", data: { amount: 20 } }), true);
  data = acknowledgeMutation(data, { client_mutation_id: "mutation-1", entity_id: 55, record: { ...transaction(), id: 55 } });
  expect(data.queue[0].entity_id).toBe(55);
  expect(materializeWorkspace(data).transactions[0]).toMatchObject({ id: 55, amount: 20, category: "Sales Revenue" });
});

test("an incomplete payment acknowledgement retains the mutation for a safe retry", () => {
  const data = addMutation(emptyWorkspace(session(true)), mutation(-1, { entity_type: "payment", data: { invoice_id: 11, amount: 40 } }), true);
  expect(() => acknowledgeMutation(data, { client_mutation_id: "mutation-1", entity_id: 99 })).toThrow(/acknowledge/);
  expect(data.queue).toHaveLength(1);
});

test("paginated remote updates retain drafts, merge partial edits and preserve payment protection", () => {
  let data = emptyWorkspace(session(true));
  data.snapshot.transactions = [transaction({ invoice_id: 11 })];
  data = addMutation(data, mutation(-1, { data: { ...transaction(), id: undefined, amount: 20 } }), true);
  data = applyPull(data, { protocol_version: 2, mode: "delta", latest_seq: 50, new_seq: 3, has_more: true, business: session(true).business, role: "owner", changes: [{ seq_num: 3, entity_type: "transaction", entity_id: 1, action: "update", data: { after: { amount: 35 } } }] });
  expect(data.sync.latestSeq).toBe(3);
  expect(data.queue).toHaveLength(1);
  expect(materializeWorkspace(data).transactions.find((row) => row.id === 1)).toMatchObject({ amount: 35, invoice_id: 11, category: "Sales Revenue" });
  expect(materializeWorkspace(data).transactions.find((row) => row.id === -1)?.amount).toBe(20);
});

test("a pulled payment journal does not post a second ledger receipt", () => {
  let data = emptyWorkspace(session(true));
  data.snapshot.invoices = [invoice()];
  data = applyPull(data, { protocol_version: 2, mode: "delta", latest_seq: 3, has_more: false, business: session(true).business, role: "owner", changes: [
    { seq_num: 1, entity_type: "payment", entity_id: 33, action: "create", data: { invoice_id: 11, amount: 40 } },
    { seq_num: 2, entity_type: "transaction", entity_id: 22, action: "create", data: { ...transaction(), id: 22, invoice_id: 11, amount: 40 } },
    { seq_num: 3, entity_type: "invoice", entity_id: 11, action: "update", data: { ...invoice(), amount_paid: 40, amount_due: 60 } },
  ] });
  expect(data.snapshot.transactions).toHaveLength(1);
  expect(materializeWorkspace(data).invoices[0].amount_due).toBe(60);
});
