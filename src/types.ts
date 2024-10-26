import Joi from "joi"

// Mock implementations

export abstract class TException {
  abstract code: number
  abstract name: string
}

export abstract class RouterBuilder {
  abstract getRegisteredRoutes: () => {
    path: string,
    method: string,
    metadata: {
      exceptions?: (new () => TException)[]
      description?: string
    } | null,
    schema?: ISchema | null
  }[]
}

// Common types

export interface ISchema {
  body?: Joi.AnySchema,
  query?: Joi.AnySchema,
  params?: Joi.AnySchema,
}

export type TRegisteredBuilder = { builder: RouterBuilder, path: string }

// Swagger types

export interface ISwaggerServer {
  url: string
  description?: string
  variables?: Record<string, any>
}
