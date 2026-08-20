import { supabase } from "./supabase"

type FilterOp = "==" | "!=" | "in" | "array-contains" | ">=" | "<=" | ">" | "<";
type Filter = { kind: "where"; field: string; op: FilterOp; value: any };
type Sort = { kind: "orderBy"; field: string; direction?: "asc" | "desc" };
type Limit = { kind: "limit"; count: number };
type Constraint = Filter | Sort | Limit;

type Ref = {
  kind: "collection" | "doc";
  table: string;
  id?: string;
  path: string[];
};

type QueryRef = Ref & {
  constraints: Constraint[];
};

const randomId = () => {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  return cryptoObj?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const normalizeTable = (name: string) => name.replace(/\//g, "_");

const cleanData = (value: any): any => {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(cleanData);
  if (value && typeof value === "object") {
    if (value.__op === "serverTimestamp") return new Date().toISOString();
    const next: Record<string, any> = {};
    Object.entries(value).forEach(([key, item]) => {
      next[key] = cleanData(item);
    });
    return next;
  }
  return value;
};

const makeDoc = (table: string, row: any) => ({
  id: String(row.id),
  ref: doc(db, table, String(row.id)),
  exists: () => Boolean(row),
  data: () => row,
});

const applyConstraints = (builder: any, constraints: Constraint[]) => {
  let queryBuilder = builder;
  constraints.forEach((constraint) => {
    if (constraint.kind === "where") {
      if (constraint.op === "==") queryBuilder = queryBuilder.eq(constraint.field, constraint.value);
      if (constraint.op === "!=") queryBuilder = queryBuilder.neq(constraint.field, constraint.value);
      if (constraint.op === "in") queryBuilder = queryBuilder.in(constraint.field, constraint.value);
      if (constraint.op === "array-contains") queryBuilder = queryBuilder.contains(constraint.field, [constraint.value]);
      if (constraint.op === ">=") queryBuilder = queryBuilder.gte(constraint.field, constraint.value);
      if (constraint.op === "<=") queryBuilder = queryBuilder.lte(constraint.field, constraint.value);
      if (constraint.op === ">") queryBuilder = queryBuilder.gt(constraint.field, constraint.value);
      if (constraint.op === "<") queryBuilder = queryBuilder.lt(constraint.field, constraint.value);
    }
    if (constraint.kind === "orderBy") {
      queryBuilder = queryBuilder.order(constraint.field, { ascending: constraint.direction !== "desc" });
    }
    if (constraint.kind === "limit") {
      queryBuilder = queryBuilder.limit(constraint.count);
    }
  });
  return queryBuilder;
};

export type Supabase = typeof db;
export const db = { provider: "supabase" } as const;

export const collection = (_dbOrRef: unknown, ...segments: string[]): Ref => {
  const table = normalizeTable(segments.filter((_, index) => index % 2 === 0).join("_"));
  return { kind: "collection", table, path: segments };
};

export const doc = (_dbOrRef: unknown, ...segments: string[]): Ref => {
  const id = String(segments[segments.length - 1]);
  const table = normalizeTable(segments.filter((_, index) => index % 2 === 0).slice(0, -1).join("_") || segments[0]);
  return { kind: "doc", table, id, path: segments };
};

export const where = (field: string, op: FilterOp, value: any): Filter => ({ kind: "where", field, op, value });
export const orderBy = (field: string, direction?: "asc" | "desc"): Sort => ({ kind: "orderBy", field, direction });
export const limit = (count: number): Limit => ({ kind: "limit", count });
export const query = (ref: Ref, ...constraints: Constraint[]): QueryRef => ({ ...ref, constraints });
export const serverTimestamp = () => ({ __op: "serverTimestamp" });

export const Timestamp = {
  fromDate: (date: Date) => date.toISOString(),
};

export const arrayUnion = (...values: any[]) => ({ __op: "arrayUnion", values });
export const arrayRemove = (...values: any[]) => ({ __op: "arrayRemove", values });

const mergeArrayOps = (current: any, patch: Record<string, any>) => {
  const next = { ...patch };
  Object.entries(patch).forEach(([key, value]) => {
    if (value && typeof value === "object" && value.__op === "arrayUnion") {
      next[key] = Array.from(new Set([...(Array.isArray(current?.[key]) ? current[key] : []), ...value.values]));
    }
    if (value && typeof value === "object" && value.__op === "arrayRemove") {
      next[key] = (Array.isArray(current?.[key]) ? current[key] : []).filter((item: any) => !value.values.includes(item));
    }
  });
  return next;
};

export const getDoc = async (ref: Ref) => {
  const { data, error } = await supabase.from(ref.table).select("*").eq("id", ref.id).maybeSingle();
  if (error) throw error;
  return makeDoc(ref.table, data);
};

export const getDocs = async (ref: Ref | QueryRef) => {
  const constraints = "constraints" in ref ? ref.constraints : [];
  const { data, error } = await applyConstraints(supabase.from(ref.table).select("*"), constraints);
  if (error) throw error;
  const docs = (data || []).map((row: any) => makeDoc(ref.table, row));
  return { docs, size: docs.length, empty: docs.length === 0 };
};

export const setDoc = async (ref: Ref, data: Record<string, any>, options?: { merge?: boolean }) => {
  const patch = cleanData({ ...data, id: ref.id });
  const { error } = options?.merge
    ? await supabase.from(ref.table).upsert(patch)
    : await supabase.from(ref.table).upsert(patch);
  if (error) throw error;
};

export const updateDoc = async (ref: Ref, data: Record<string, any>) => {
  const current = await getDoc(ref).then((snapshot) => snapshot.data()).catch(() => null);
  const patch = cleanData(mergeArrayOps(current, data));
  const { error } = await supabase.from(ref.table).update(patch).eq("id", ref.id);
  if (error) throw error;
};

export const addDoc = async (ref: Ref, data: Record<string, any>) => {
  const id = randomId();
  const row = cleanData({ ...data, id });
  const { error } = await supabase.from(ref.table).insert(row);
  if (error) throw error;
  return doc(db, ref.table, id);
};

export const deleteDoc = async (ref: Ref) => {
  const { error } = await supabase.from(ref.table).delete().eq("id", ref.id);
  if (error) throw error;
};

export const writeBatch = () => {
  const ops: Array<() => Promise<void>> = [];
  return {
    set: (ref: Ref, data: Record<string, any>, options?: { merge?: boolean }) => ops.push(() => setDoc(ref, data, options)),
    update: (ref: Ref, data: Record<string, any>) => ops.push(() => updateDoc(ref, data)),
    delete: (ref: Ref) => ops.push(() => deleteDoc(ref)),
    commit: async () => {
      for (const op of ops) await op();
    },
  };
};

export const onSnapshot = (ref: Ref | QueryRef, onNext: (snapshot: any) => void, onError?: (error: any) => void) => {
  let active = true;
  const load = async () => {
    try {
      if ("id" in ref && ref.kind === "doc") {
        const snapshot = await getDoc(ref);
        if (active) onNext(snapshot);
        return;
      }
      const snapshot = await getDocs(ref);
      if (active) onNext(snapshot);
    } catch (error) {
      onError?.(error);
    }
  };
  void load();
  const channel = supabase
    .channel(`compat-${ref.table}-${randomId()}`)
    .on("postgres_changes", { event: "*", schema: "public", table: ref.table }, () => void load())
    .subscribe();

  return () => {
    active = false;
    void supabase.removeChannel(channel);
  };
};

