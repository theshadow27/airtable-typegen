/* typed-table.ts */
import Airtable from 'airtable'

export type AirtableUid = string
export type FieldSetWithId<T extends AirtableUid> = Omit<Airtable.FieldSet, keyof Airtable.FieldSet> & { _id?: T }
export type TypedSelectOptions<ID extends AirtableUid, T extends FieldSetWithId<ID>> = Airtable.SelectOptions<T>

export class TypedTable<ID extends AirtableUid, T extends FieldSetWithId<ID>> {
  readonly _id: string
  readonly _name: string
  readonly table: Airtable.Table<T>
  constructor(base: InstanceType<typeof Airtable.Base>, id: string, name: string) {
    this._id = id
    this._name = name
    this.table = new Airtable.Table<T>(base, id, name)
  }
  async find(id: ID): Promise<T | undefined> {
    const result = await this.table.find(id)
    return result && result.fields ? { _id: id, ...result.fields } : undefined
  }
  async select(options?: TypedSelectOptions<ID, T>): Promise<T[]> {
    const result = await this.table.select(options).all()
    return result.map((r) => ({ _id: r.id, ...r.fields }))
  }
  async create(recordData: string | (Partial<T> & { _id: undefined })): Promise<T> {
    const result = await this.table.create(recordData)
    return { _id: result.id as ID, ...result.fields }
  }
  async update(recordData: Partial<T> & { _id: ID }): Promise<T> {
    const { _id, ...fields } = recordData
    const result = await this.table.update(_id, fields as Partial<T>)
    return { _id, ...result.fields }
  }
  async destroy(id: ID): Promise<T> {
    const result = await this.table.destroy(id)
    return { _id: id, ...result.fields }
  }
  cache(options: TypedSelectOptions<ID, T>): CachedQuery<ID, T> {
    return new CachedQuery(this, options)
  }
}
export class CachedQuery<ID extends AirtableUid, T extends FieldSetWithId<ID>> {
  private cached: T[] | undefined
  constructor(readonly table: TypedTable<ID, T>, readonly query: TypedSelectOptions<ID, T>) {}
  async fetch(): Promise<T[]> {
    if (!this.cached) {
      this.cached = await this.table.select(this.query)
    }
    return this.cached
  }
  flush(): CachedQuery<ID, T> {
    this.cached = undefined
    return this
  }
}

/* End typed-table.ts */
