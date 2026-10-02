import {
  AliasNode,
  AndNode,
  BinaryOperationNode,
  ColumnNode,
  type DeleteQueryNode,
  IdentifierNode,
  type InsertQueryNode,
  type JoinNode,
  type KyselyPlugin,
  OnNode,
  type OperationNode,
  OperationNodeTransformer,
  OperatorNode,
  ParensNode,
  type PluginTransformQueryArgs,
  type PluginTransformResultArgs,
  PrimitiveValueListNode,
  type QueryResult,
  ReferenceNode,
  type RootOperationNode,
  type SelectQueryNode,
  TableNode,
  type UnknownRow,
  type UpdateQueryNode,
  ValueListNode,
  ValueNode,
  ValuesNode,
  WhereNode,
} from "kysely";

/** Tables that belong to a tenant, and the column holding the tenant id. */
export const TENANT_COLUMNS: Record<string, string> = {
  folders: "tenant_id",
  albums: "tenant_id",
  sections: "tenant_id",
  image_files: "tenant_id",
  photos: "tenant_id",
  tenant_invites: "tenant_id",
  folder_sort: "tenant_id",
  album_positions: "tenant_id",
  folder_positions: "tenant_id",
  share_links: "tenant_id",
  source_settings: "tenant_id",
  source_accounts: "tenant_id",
  user: "tenantId", // better-auth naming
};

/**
 * Confines every query to one tenant. SELECT/UPDATE/DELETE get
 * `<table>.tenant_id = <tenant>` for each tenant table they read or write:
 * in WHERE for the target tables, in ON for joined ones, subqueries included.
 * INSERTs must set the tenant column to exactly this tenant, or they throw.
 *
 * Raw `sql` templates are not seen by the plugin: don't use them on tenant
 * tables in scoped code.
 */
export class TenantScopePlugin implements KyselyPlugin {
  readonly #transformer: TenantTransformer;

  constructor(tenantId: string) {
    this.#transformer = new TenantTransformer(tenantId);
  }

  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    return this.#transformer.transformNode(args.node);
  }

  async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    return args.result;
  }
}

/** The name a table is referenced by in the query (its alias, if any) and its real name. */
function tableRef(node: OperationNode): { table: string; ref: string } | null {
  if (TableNode.is(node)) {
    const table = node.table.identifier.name;
    return { table, ref: table };
  }
  if (AliasNode.is(node) && TableNode.is(node.node) && IdentifierNode.is(node.alias)) {
    return { table: node.node.table.identifier.name, ref: node.alias.name };
  }
  return null;
}

class TenantTransformer extends OperationNodeTransformer {
  constructor(private readonly tenantId: string) {
    super();
  }

  /** `ref.column = tenantId` for a tenant table, else null. */
  private filterFor(node: OperationNode): OperationNode | null {
    const t = tableRef(node);
    const column = t && TENANT_COLUMNS[t.table];
    if (!t || !column) return null;
    return BinaryOperationNode.create(
      ReferenceNode.create(ColumnNode.create(column), TableNode.create(t.ref)),
      OperatorNode.create("="),
      ValueNode.create(this.tenantId),
    );
  }

  private withWhere<T extends { where?: WhereNode }>(node: T, tables: readonly OperationNode[]): T {
    let where = node.where?.where;
    for (const table of tables) {
      const filter = this.filterFor(table);
      if (!filter) continue;
      where = where ? AndNode.create(ParensNode.create(where), filter) : filter;
    }
    return where ? { ...node, where: WhereNode.create(where) } : node;
  }

  private withJoinFilters(joins: readonly JoinNode[] | undefined): JoinNode[] | undefined {
    return joins?.map((join) => {
      const filter = this.filterFor(join.table);
      if (!filter) return join;
      const on = join.on ? AndNode.create(ParensNode.create(join.on.on), filter) : filter;
      return { ...join, on: OnNode.create(on) };
    });
  }

  protected override transformSelectQuery(node: SelectQueryNode): SelectQueryNode {
    const inner = super.transformSelectQuery(node);
    return {
      ...this.withWhere(inner, inner.from?.froms ?? []),
      joins: this.withJoinFilters(inner.joins),
    };
  }

  protected override transformUpdateQuery(node: UpdateQueryNode): UpdateQueryNode {
    const inner = super.transformUpdateQuery(node);
    const tables = [...(inner.table ? [inner.table] : []), ...(inner.from?.froms ?? [])];
    return { ...this.withWhere(inner, tables), joins: this.withJoinFilters(inner.joins) };
  }

  protected override transformDeleteQuery(node: DeleteQueryNode): DeleteQueryNode {
    const inner = super.transformDeleteQuery(node);
    return {
      ...this.withWhere(inner, inner.from.froms),
      joins: this.withJoinFilters(inner.joins),
    };
  }

  protected override transformInsertQuery(node: InsertQueryNode): InsertQueryNode {
    const inner = super.transformInsertQuery(node);
    const t = inner.into && tableRef(inner.into);
    const column = t && TENANT_COLUMNS[t.table];
    if (!t || !column) return inner;

    const index = inner.columns?.findIndex((c) => c.column.name === column) ?? -1;
    if (index < 0 || !inner.values || !ValuesNode.is(inner.values)) {
      throw new Error(`Insert into ${t.table} must set ${column}`);
    }
    for (const row of inner.values.values) {
      const value = PrimitiveValueListNode.is(row)
        ? row.values[index]
        : ValueListNode.is(row) && row.values[index] && ValueNode.is(row.values[index])
          ? row.values[index].value
          : undefined;
      if (value !== this.tenantId) throw new Error(`Insert into ${t.table} for another tenant`);
    }
    return inner;
  }
}
