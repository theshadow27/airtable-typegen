import { Command, Flags } from '@oclif/core'
import { paramCase, pascalCase } from 'change-case'
import * as dotenv from 'dotenv'
import fs from 'fs-extra'
import path from 'node:path'
import z from 'zod'

import {
  BaseListMetadata,
  BaseListMetadataSchema,
  BaseMetadata,
  TableListMetadata,
  TableListMetadataSchema,
  TableMetadata,
} from '../schemas/api'
import { AIRTABLE_API_BASE, AIRTABLE_API_BASE_META_PATH, AIRTABLE_API_VERSION } from '../utils/constants'
import { AttachmentZodTmpl, CollaboratorZodTmpl, getTsType, getZodType, tsExtras } from '../utils/field-mappings'
import { getFieldEnumName, hasAttachmentField, hasCollaboratorField, isReadonlyField } from '../utils/helpers'
import httpRequest from '../utils/http-request'

dotenv.config()

const ARG_NAME = 'baseId'

class Main extends Command {
  static description = `Generate TypeScript types and/or Zod schemas from an Airtable Base.
Will read your Airtable API key from the AIRTABLE_TYPEGEN_ACCESS_TOKEN environment variable.
Reads environment from .env file if present in current working directory.`

  static examples = [
    `$ airtable-typegen appABC123
> Outputs TypeScript definitions to ./base-name.ts`,
    `$ airtable-typegen appABC123 -t MyTable,tblUOInmv7kanMKjr
> Outputs TypeScript definitions to ./base-name.ts for the specified tables`,
    `$ airtable-typegen appABC123 -z -o ./src/schemas/airtable.ts
> Outputs Zod schemas to ./src/schemas/airtable.ts`,
  ]

  static flags = {
    version: Flags.version({ char: 'v' }),
    jsoncache: Flags.string({
      char: 's',
      description:
        'Specify a JSON file to use (instead of fetching from Airtable). If it does not exist, we will write it.',
      required: false,
    }),
    output: Flags.string({
      char: 'o',
      description: 'The file (relative to CWD) to write generated code to (defaults to "base-name.ts")',
      required: false,
    }),
    zod: Flags.boolean({
      char: 'z',
      description: 'Generate Zod schemas instead of TypeScript definitions',
      required: false,
    }),
    tables: Flags.string({
      char: 't',
      description: 'A comma-separated list of tables (names or ids) to generate from (defaults to all tables)',
      required: false,
    }),
    id: Flags.boolean({
      description:
        'Use this key as the strongly typed IDs within the generated code (TypeScript only) reverse with --no-id',
      required: false,
      default: true,
    }),
    controllers: Flags.boolean({
      char: 'c',
      description: 'Generate controllers for each table (TypeScript only)',
      required: false,
      default: false,
    }),
  }

  static args = [
    {
      name: ARG_NAME,
      description: 'The Airtable Base ID (looks like appABC123XYZ). Can specify multiple.',
      required: true,
    },
  ]

  private accessToken = process.env.AIRTABLE_TYPEGEN_ACCESS_TOKEN
  private baseId: string | undefined
  private flags: {
    version: void
    zod?: boolean
    tables?: string
    addid?: string
    addcontrollers?: boolean
    jsoncache?: string
    [flag: string]: any
  } = {
    version: undefined,
  }
  private baseMetadata: BaseListMetadata | undefined
  private tableMetadata: TableListMetadata | undefined
  private shouldWriteJson = false

  private async fetchAirtableApi<T>(reqPath: string): Promise<T> {
    this.log(`Fetching ${reqPath}`)
    if (!this.accessToken) {
      this.error(
        'No Airtable Access Token token provided. Make sure to set the AIRTABLE_TYPEGEN_ACCESS_TOKEN environment variable.',
        {
          exit: 1,
        },
      )
    }

    return httpRequest({
      hostname: AIRTABLE_API_BASE.replace(/https?:\/\//, ''),
      path: AIRTABLE_API_VERSION + reqPath,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    })
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Main)
    this.baseId = args[ARG_NAME]
    this.flags = flags

    if (flags.jsoncache && (await this.tryReadJsonCache(flags.jsoncache))) {
      this.log('Using cached Airtable metadata')
    } else {
      this.log('Fetching Airtable metadata')
    }

    const baseMeta = await this.getBaseMetadata()
    const tableMeta = await this.getTableMetadata(flags.tables?.split(','))

    let data: string
    if (flags.zod) {
      this.log('Generating Zod schemas')
      data = await this.generateZodSchemas(baseMeta, tableMeta)
    } else {
      this.log('Generating TypeScript definitions')
      data = await this.generateTSDefinitions(baseMeta, tableMeta)
    }

    const filepath = flags.output ?? `${paramCase(baseMeta.name)}.ts`
    const output = path.resolve(process.cwd(), filepath)
    await fs.ensureFile(output)
    await fs.writeFile(output, data)

    if (flags.jsoncache && this.shouldWriteJson) {
      const json = {
        baseMetadata: this.baseMetadata,
        tableMetadata: this.tableMetadata,
      }
      const sfile = path.resolve(process.cwd(), flags.jsoncache)
      await fs.ensureFile(sfile)
      await fs.writeJSON(sfile, json, { spaces: 2 })
    }
    this.log('Done!')
  }

  private async tryReadJsonCache(file: string): Promise<boolean> {
    const input = path.resolve(process.cwd(), file)
    const exists = await fs.pathExists(input)

    if (exists) {
      try {
        const json = await fs.readJSON(input)
        if (json && json.baseMetadata && json.tableMetadata) {
          this.baseMetadata = json.baseMetadata
          this.tableMetadata = json.tableMetadata
          return true
        }
      } catch (e) {
        if (e instanceof z.ZodError) this.log('Error parsing schema file: ' + input, e.errors)
        else this.log('Error reading schema file: ' + input, e)
      }
    } else {
      this.log('Schema file does not exist yet: ' + input)
    }

    this.shouldWriteJson = true
    this.baseMetadata = undefined
    this.tableMetadata = undefined
    return false
  }
  /**
   * @param allowlist A list of table names or IDs to filter for
   * @returns Metadata for all (or allowlisted) tables in the specified base
   */
  private async getTableMetadata(allowlist?: string[]): Promise<TableMetadata[]> {
    const res =
      this.tableMetadata ??
      (this.tableMetadata = await this.fetchAirtableApi(`${AIRTABLE_API_BASE_META_PATH}/${this.baseId}/tables`))
    const metadata = TableListMetadataSchema.parse(res)

    if (!allowlist) return metadata.tables

    const tables: TableMetadata[] = []
    for (const table of metadata.tables) {
      if (allowlist.includes(table.id) || allowlist.includes(table.name)) {
        tables.push(table)
      }
    }

    if (tables.length !== allowlist.length) {
      const requestedTables = allowlist.join(', ')
      const foundTables = tables.map((t) => t.name).join(', ')
      this.error(`Could not find all tables:\n\nRequested: ${requestedTables}\nFound: ${foundTables}`, {
        exit: 1,
      })
    }

    return tables
  }

  /**
   * @returns Metadata for the specified base
   */
  private async getBaseMetadata() {
    const res = this.baseMetadata ?? (this.baseMetadata = await this.fetchAirtableApi(AIRTABLE_API_BASE_META_PATH))
    const metadata = BaseListMetadataSchema.parse(res)

    const baseMeta = metadata.bases.find((b) => b.id === this.baseId)
    if (!baseMeta) {
      this.error(`Could not find base with ID ${this.baseId}`, {
        exit: 1,
      })
    }

    return baseMeta
  }

  private async generateZodSchemas(base: BaseMetadata, tables: TableMetadata[]) {
    const lines: string[] = []
    lines.push("import { z } from 'zod'")
    lines.push('')

    const allFields = tables.map((t) => t.fields).flat()
    if (hasAttachmentField(allFields)) {
      lines.push(AttachmentZodTmpl)
      lines.push('')
    }
    if (hasCollaboratorField(allFields)) {
      lines.push(CollaboratorZodTmpl)
      lines.push('')
    }

    for (const table of tables) {
      // Generate enums for all select fields of this table
      for (const field of table.fields) {
        if (field.type === 'singleSelect' || field.type === 'multipleSelects') {
          const enumName = getFieldEnumName(table, field)
          lines.push(`export const ${enumName} = z.enum([`)
          for (const choice of field.options.choices) {
            lines.push(`  '${choice.name}',`)
          }
          lines.push('])')
          lines.push('')
        }
      }

      const tableSchemaName = `${pascalCase(table.name)}Schema`
      const tableTypeName = pascalCase(table.name)
      lines.push(`export const ${tableSchemaName} = z.object({`)

      for (const field of table.fields) {
        const fieldName = field.name
        const fieldType = getZodType(table, field)
        // NOTE: Airtable API will NOT return a field if it's blank
        // so almost everything has to be marked optional unfortunately
        const isReadonly = isReadonlyField(field)
        const suffix = isReadonly ? ',' : '.optional(),'
        lines.push(`  '${fieldName}': ${fieldType}${suffix}`)
      }

      lines.push('})')
      lines.push(`export type ${tableTypeName} = z.infer<typeof ${tableSchemaName}>`)
      lines.push('')
    }

    return lines.join('\n')
  }

  private async generateTSDefinitions(base: BaseMetadata, tables: TableMetadata[]) {
    const controllers = !!this.flags.controllers
    const genIds = !!this.flags.id

    const tsOpts = { useAirtableLibraryTypes: controllers }

    const lines: string[] = []

    const allFields = tables.map((t) => t.fields).flat()

    if (controllers) {
      lines.push(`import Airtable from 'airtable';`)
    } else {
      if (hasAttachmentField(allFields)) lines.push(tsExtras.getAdditionalTsForAttachments(), '')
      if (hasCollaboratorField(allFields)) lines.push(tsExtras.getAdditionalTsForCollaborators(), '')
    }

    lines.push(`export type AirtableUid = string;`)
    lines.push(`export type FieldSetWithId<T extends AirtableUid> = Omit<Airtable.FieldSet, keyof Airtable.FieldSet> & { _id?: T };`)
    //if (genIds === 'Symbol') {
    //  genIds = `[$id]`
    //  lines.push(`export const $id = Symbol('__airtable_id__');`)
    //}

    for (const table of tables) {
      const tableName = pascalCase(table.name)
      lines.push('', `export type ${tableName}Id = AirtableUid;`, '')
      lines.push(`export interface ${tableName}${controllers ? ' extends FieldSetWithId<' + tableName + 'Id>' : ''} {`)
      lines.push(`  _id?: ${tableName}Id; // not respected by the official Airtable Library`)
      // add the ID symbol when needed
      //if (genIds) lines.push(`  ${genIds}: ${tableName}Id;`)

      for (const field of table.fields) {
        const fieldName = field.name
        let fieldType = getTsType(field, tsOpts)

        if (genIds && field.type === 'multipleRecordLinks') {
          let linkedTableIdType = tables
            .filter((t) => t.id == field.options.linkedTableId)
            .map((t) => pascalCase(t.name) + 'Id')
            .pop()
          if (!linkedTableIdType) linkedTableIdType = 'AirtableUid' // ? Not found?
          fieldType = `Array<${linkedTableIdType}>`
        }

        // NOTE: Airtable API will NOT return a field if it's blank
        // so almost everything has to be marked optional unfortunately
        const isReadonly = isReadonlyField(field)
        lines.push(`  '${fieldName}'${isReadonly ? '' : '?'}: ${fieldType}`)
      }

      lines.push('}', '')
    }

    if (controllers) {
      const baseName = pascalCase(base.name)
      const className = `${baseName}Base`
      lines.push(`
export class TypedTable<ID extends AirtableUid, T extends FieldSetWithId<ID>> {
  readonly _id : string
  readonly _name : string
  readonly table: Airtable.Table<T>
  constructor(base: InstanceType<typeof Airtable.Base>, id: string, name: string) {
    this._id = id
    this._name = name
    this.table = new Airtable.Table<T>(base, id, name);
  }
  async find(id: ID): Promise<T | undefined> {
    const result = await this.table.find(id)
    return result && result.fields ? {_id: id, ...result.fields} : undefined;
  }
  async select(options?: Airtable.SelectOptions<T>): Promise<T[]> {
    const result = await this.table.select(options).all()
    return result.map(r => ({_id: r.id, ...r.fields}))
  }
  async create(recordData: string | (Partial<T> & {_id: undefined})): Promise<T> {
    const result = await this.table.create(recordData)
    return {_id: result.id as ID, ...result.fields}
  }
  async update(recordData: Partial<T> & {_id: ID}): Promise<T> {
    const {_id, ...fields } = recordData
    const result = await this.table.update(_id, fields as Partial<T>)
    return {_id, ...result.fields}
  }
  async destroy(id: ID): Promise<T> {
    const result = await this.table.destroy(id)
    return {_id: id, ...result.fields}
  }
}

export class ${className} {
  readonly at: Airtable
  readonly base: InstanceType<typeof Airtable.Base>
  static readonly _id: string = '${base.id}'
  static readonly _name: string = '${base.name}'
  constructor(options: Airtable.AirtableOptions) {
      this.at = new Airtable(options)
      this.base = new Airtable.Base(this.at, ${className}._id);
  }`,'')

      tables
        .map((x) => ({ ...x, tname: pascalCase(x.name) }))
        .forEach(
          ({ tname, id, name }) =>
            lines.push(`  get${tname}Table = ()=> new TypedTable<${tname}Id, ${tname}>(this.base, '${id}', '${name}');`), //as Airtable.Table<${tname}>;`),
        )
      lines.push('}', '')
    }

    return lines.join('\n')
  }
}

export = Main
