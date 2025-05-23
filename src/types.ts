import Joi from "joi"

// Mock implementations

export abstract class Exception {
  abstract code: number
  abstract name: string
}

export abstract class CustomResponse {
  abstract code: number
  abstract headers: Headers
  abstract example?: any
}

export interface RouteMetadata {
  example?: any
  responses?: ((new () => Exception) | (new () => CustomResponse))[]
  description?: string
  auth?: string[] | Record<string, string[]>
  deprecated?: boolean
}

export abstract class RouterBuilder {
  abstract readonly root: string

  abstract readonly tags?: string[]

  abstract getRegisteredRoutes: () => {
    path: string,
    method: string,
    metadata: RouteMetadata | null
    schema?: ISchema | null
  }[]
}

// Common types

export interface ISchema {
  body?: Joi.AnySchema
  query?: Joi.AnySchema
  params?: Joi.AnySchema
  headers?: Joi.AnySchema
}

// Swagger types

export interface ISwaggerServer {
  url: string
  description?: string
  variables?: Record<string, any>
}
