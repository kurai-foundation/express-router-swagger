import j2s from "joi-to-swagger"
import { ISwaggerServer, RouterBuilder } from "./types"
import classNameToReadable from "./class-name-to-readable"

export interface ISwaggerTransformerOptions {
  title?: string
  description?: string
  version?: string
  servers?: ISwaggerServer[]
  builders: RouterBuilder[]
}

export default function swaggerTransformer(options: ISwaggerTransformerOptions) {
  const paths: Record<string, any> = {}

  options.builders.forEach(builder => {
    const rootPath = builder.root
    builder.getRegisteredRoutes().forEach(route => {
      // Replace `:param` with `{param}` for Swagger compatibility
      const fullPath = `${ rootPath }${ route.path }`.replace(/:([a-zA-Z0-9_]+)\?/g, "{$1}")
      const method = route.method.toLowerCase()

      // Initialize path entry if it doesn't exist
      if (!paths[fullPath]) {
        paths[fullPath] = {}
      }

      const routeMetadata = route.metadata || {}
      const operationObject: any = {
        summary: routeMetadata.description || `Endpoint for ${ method.toUpperCase() } ${ fullPath }`,
        operationId: `${ method }_${ fullPath.replace(/\//g, "_") }`,
        tags: [rootPath.replace(/\//g, "")],
        responses: {}
      }

      operationObject.parameters = []

      if (route.schema) {
        const { query, params, body } = route.schema

        // Handle path parameters
        if (params) {
          const paramsSchema = j2s(params).swagger
          Object.keys(paramsSchema.properties || {}).forEach(name => {
            const isOptional = route.path.includes(`:${ name }?`)
            operationObject.parameters.push({
              name,
              in: "path",
              required: true,  // Path parameters are always required in OpenAPI
              schema: paramsSchema.properties![name],
              description: paramsSchema.properties![name].description ||
                (isOptional ? "Optional parameter" : "")
            })
          })
        }

        // Handle query parameters
        if (query) {
          const querySchema = j2s(query).swagger
          operationObject.parameters.push(
            ...Object.keys(querySchema.properties || {}).map(name => ({
              name,
              in: "query",
              required: querySchema.required?.includes(name) ?? false,
              schema: querySchema.properties![name]
            }))
          )
        }

        // Handle request body
        if (body) {
          const bodySchema = j2s(body).swagger
          operationObject.requestBody = {
            content: {
              "application/json": {
                schema: bodySchema
              }
            }
          }
        }
      }

      // Handle responses
      let hasCustomResponse = false;
      (routeMetadata.responses || []).forEach((response: any) => {
        const responseInstance = new response()
        if (["1", "2", "3"].includes(String(responseInstance.code)[0])) {
          hasCustomResponse = true
          operationObject.responses[responseInstance.code] = {
            description: "Success response"
          }
        } else if (responseInstance.code && responseInstance.name) {
          operationObject.responses[responseInstance.code] = {
            description: classNameToReadable(responseInstance.name)
          }
        }
      })

      // Add default 200 response if no CustomResponse is present
      if (!hasCustomResponse) {
        operationObject.responses["200"] = { description: "Successful response" }
      }

      paths[fullPath][method] = operationObject
    })
  })


  // Construct final Swagger document
  return {
    openapi: "3.0.0",
    info: {
      title: options.title || "API Documentation",
      description: options.description || "Auto-generated Swagger documentation",
      version: options.version || "1.0.0"
    },
    servers: options.servers || [{ url: "http://127.0.0.1:3000" }],
    paths
  }
}
