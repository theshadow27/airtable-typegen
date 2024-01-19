import { printNode } from 'zod-to-ts'

import { TableMetadata } from '../schemas/api'
import { CellFormatTypescriptDefinitions, FieldMetadata, FieldType } from '../schemas/fields'
import { getFieldEnumName } from './helpers'

export function getZodType(table: TableMetadata, field: FieldMetadata) {
  switch (field.type) {
    case 'autoNumber':
      return 'z.number().int().positive()'
    case 'barcode':
      return 'z.object({ text: z.string(), type: z.string() })'
    case 'button':
      return 'z.object({ label: z.string() }).merge(z.record(z.unknown()))'
    case 'checkbox':
      return 'z.boolean()'
    case 'count':
      return 'z.number().int().nonnegative()'
    case 'createdBy':
    case 'lastModifiedBy':
    case 'singleCollaborator':
      return 'AirtableCollaboratorSchema'
    case 'date':
    case 'dateTime':
    case 'createdTime':
    case 'lastModifiedTime':
      return 'z.coerce.date()'
    case 'number':
    case 'percent':
    case 'currency': {
      if ('options' in field && field?.options?.precision === 0) {
        return 'z.number().int().positive()'
      } else {
        return 'z.number().positive()'
      }
    }
    case 'duration':
      return 'z.number()'
    case 'rating':
      return 'z.number().min(0).max(5)'
    case 'email':
      return 'z.string().email()'
    case 'aiText':
    case 'multilineText':
    case 'phoneNumber':
    case 'singleLineText':
    case 'url':
    case 'richText':
      return 'z.string()'
    case 'rollup':
    case 'formula':
      return 'z.string().or(z.number())'
    case 'multipleCollaborators':
      return 'z.array(AirtableCollaboratorSchema)'
    case 'multipleAttachments':
      return 'z.array(AirtableAttachmentSchema)'
    case 'multipleLookupValues':
      return 'z.union([z.array(z.string()), z.array(z.boolean()), z.array(z.number()), z.array(z.record(z.unknown()))])'
    case 'multipleRecordLinks':
      return 'z.array(z.string())'
    case 'singleSelect':
      return getFieldEnumName(table, field)
    case 'multipleSelects':
      return `z.array(${getFieldEnumName(table, field)})`
    // TODO not sure what this one is
    case 'externalSyncSource':
      return 'z.unknown()'
  }

  // @ts-expect-error - we should never fall through to here, but just in case
  throw new Error(`Unrecognized field type: ${field.type} (on field '${field.name}')`)
}

export const CollaboratorZodTmpl = `export const AirtableCollaboratorSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
})`

export const AttachmentZodTmpl = `export const AirtableThumbnailSchema = z.object({
  url: z.string(),
  width: z.number(),
  height: z.number(),
})`

function getTsForFieldType(type: FieldType): string {
  return printNode(CellFormatTypescriptDefinitions[type])
}

export interface TsOptions {
  useAirtableLibraryTypes: boolean
}

export function getTsType(field: FieldMetadata, opts: TsOptions) {
  switch (field.type) {
    case 'aiText':
    case 'button':
      return opts.useAirtableLibraryTypes ? 'string' : getTsForFieldType(field.type) // TODO: this is wrong, but at least it has 'url', and the Airtable JS library has the wrong definition for FieldSet
    case 'autoNumber':
    case 'barcode':
    case 'checkbox':
    case 'count':
    case 'currency':
    case 'date':
    case 'dateTime':
    case 'duration':
    case 'email':
    case 'externalSyncSource':
    case 'multilineText':
    case 'multipleCollaborators':
    case 'multipleRecordLinks':
    case 'number':
    case 'percent':
    case 'phoneNumber':
    case 'rating':
    case 'richText':
    case 'singleLineText':
    case 'url':
      return getTsForFieldType(field.type)
    case 'createdBy':
    case 'lastModifiedBy':
    case 'singleCollaborator':
      return opts.useAirtableLibraryTypes ? 'Airtable.Collaborator' : 'IAirtableCollaborator'
    case 'multipleAttachments':
      return opts.useAirtableLibraryTypes ? 'Airtable.Attachment[]' : 'Array<IAirtableAttachment>'
    case 'createdTime':
    case 'formula':
    case 'lastModifiedTime':
    case 'multipleLookupValues':
    case 'rollup':
      return getTsForFieldType(field.options?.result?.type ?? field.type) // use derrived type if available
    case 'singleSelect':
      return field.options.choices.map((choice) => `'${choice.name}'`).join(' | ')
    case 'multipleSelects':
      return `Array<${field.options.choices.map((choice) => `'${choice.name}'`).join(' | ')}>`
  }

  // @ts-expect-error - we should never fall through to here, but just in case
  throw new Error(`Unrecognized field type: ${field.type} (on field '${field.name}')`)
}

function getAdditionalTsForAttachments(){
  return `
  export interface IAirtableThumbnail {
    url: string
    width: number
    height: number
  }
  export interface IAirtableAttachment {
    id: string
    url: string
    filename: string
    size: number
    type: string
    thumbnails?: {
      small: IAirtableThumbnail
      large: IAirtableThumbnail
      full: IAirtableThumbnail
    }
  }
  `
}
function getAdditionalTsForCollaborators(){
  return `
  export interface IAirtableCollaborator {
    id: string
    email: string
    name: string
  }
  `
}

export const tsExtras = {
  getAdditionalTsForAttachments,
  getAdditionalTsForCollaborators
}

// export interface IAirtableFieldSet {
//     [key: string]: undefined | IAirtableFieldValue;
// }

// export declare type IAirtableRecords<TFields extends IAirtableFieldSet> = ReadonlyArray<IAirtableRecord<TFields>>;

// export interface IAirtableRecordData<TFields> {
//   id: string;
//   fields: TFields;
//   commentCount?: number;
// }
// export interface IAirtableSortParameter<TFields> {
//   field: keyof TFields;
//   direction?: 'asc' | 'desc';
// }
// export interface IAirtableQueryParams<TFields> {
//   fields?: (keyof TFields)[];
//   filterByFormula?: string;
//   maxRecords?: number;
//   pageSize?: number;
//   offset?: number;
//   sort?: IAirtableSortParameter<TFields>[];
//   view?: string;
//   cellFormat?: 'json' | 'string';
//   timeZone?: string;
//   userLocale?: string;
//   method?: string;
//   returnFieldsByFieldId?: boolean;
//   recordMetadata?: string[];
// }

// export const LookupTsName = `IAirtableLookup`
// export const LookupTsTmpl = `export type ${LookupTsName} = Array<string | boolean | number | Record<string, unknown>>`

// export const CollaboratorTsName = `IAirtableCollaborator`

// export const CollaboratorTsTmpl = `export interface ${CollaboratorTsName} {
//   id: string
//   email: string
//   name: string
// }`

// export const ThumbnailTsName = `IAirtableThumbnail`
// export const ThumbnailTsTmpl = `export interface IAirtableThumbnail {
//   url: string
//   width: number
//   height: number
// }`

// export const AttachmentTsName = `IAirtableAttachment`
// export const AttachmentTsImpl = `export interface ${AttachmentTsName} {
//     id: string
//     url: string
//     filename: string
//     size: number
//     type: string
//     thumbnails?: {
//       small: IAirtableThumbnail
//       large: IAirtableThumbnail
//       full: IAirtableThumbnail
//     }
//   }`

// // All fields must conform to this type to be compatible with the Airtable JS SDK
// export const FieldTsImpl = `string | number | boolean | ${CollaboratorTsName} | readonly ${CollaboratorTsName}[] | readonly string[] | readonly ${AttachmentTsName}[] | undefined`

// export interface Collaborator {
//   id: string;
//   email: string;
//   name: string;
// }
// export interface Thumbnail {
//   url: string;
//   width: number;
//   height: number;
// }
// export interface Attachment {
//   id: string;
//   url: string;
//   filename: string;
//   size: number;
//   type: string;
//   thumbnails?: {
//       small: Thumbnail;
//       large: Thumbnail;
//       full: Thumbnail;
//   };
// }
