import Joi, { AnySchema } from "joi"
import j2s from "joi-to-swagger"
import { SecurityScheme } from "../../types"
import { ISwaggerServer, RouteMetadata, RouterBuilder } from "./types"
import classNameToReadable from "./class-name-to-readable"

export interface ISwaggerTransformerOptions {
  title?: string;
  description?: string;
  version?: string;
  servers?: ISwaggerServer[];
  builders: RouterBuilder[];
  securitySchemas?: Record<string, SecurityScheme>;
}

function withClassName<T = AnySchema>(schema: T): T {
  if (!Joi.isSchema(schema)) return schema
  const d: any = (schema as any).describe()
  const label = d?.flags?.label as string | undefined
  const hasClass =
    Array.isArray(d.metas) && d.metas.some((m: any) => m?.className)
  return label && !hasClass ? (schema as any).meta({ className: label }) : schema
}

function isMultipart(schema: AnySchema): boolean {
  if (!Joi.isSchema(schema)) return false
  const d: any = (schema as any).describe()
  return (
    Array.isArray(d.metas) &&
    d.metas.some((m: any) => m?.contentType === "multipart")
  )
}

export default function swaggerTransformer(options: ISwaggerTransformerOptions) {
  const paths: Record<string, any> = {}
  const components: Record<string, any> = {
    schemas: {},
    securitySchemes: options.securitySchemas ?? {},
    parameters: {}
  }

  const paramCache = new Map<string, string>()
  const opIdSet = new Set<string>()

  const collect = (comp: any) => {
    if (comp?.schemas) Object.assign(components.schemas, comp.schemas)
  }

  const resolveProps = (swaggerSchema: any): { props?: any; required?: string[] } => {
    if (swaggerSchema?.properties)
      return { props: swaggerSchema.properties, required: swaggerSchema.required }
    if (swaggerSchema?.$ref) {
      const refName = String(swaggerSchema.$ref).replace(
        /^#\/components\/schemas\//,
        ""
      )
      const refSchema = components.schemas?.[refName]
      if (refSchema?.properties)
        return { props: refSchema.properties, required: refSchema.required }
    }
    return {}
  }

  const pushParam = (paramObj: any, arr: any[]) => {
    const { in: loc, name, required: req, ...rest } = paramObj
    const sig = JSON.stringify(rest)
    if (paramCache.has(sig)) {
      arr.push({ $ref: `#/components/parameters/${ paramCache.get(sig) }` })
    }
    else {
      const compName = `${ loc }_${ name }`.replace(/[^A-Za-z0-9]/g, "_")
      components.parameters[compName] = paramObj
      paramCache.set(sig, compName)
      arr.push({ $ref: `#/components/parameters/${ compName }` })
    }
  }

  options.builders.forEach((builder) => {
    const rootPath = builder.root

    builder.getRegisteredRoutes().forEach((route) => {
      let fullPath = `${ rootPath }${ route.path }`
        .replace(/:([a-zA-Z0-9_]+)\?/g, "{$1}")
        .replace(/\/{2,}/, "/")
      if (fullPath.endsWith("/") && fullPath.length > 1)
        fullPath = fullPath.slice(0, -1)

      const method = route.method.toLowerCase()
      if (!paths[fullPath]) paths[fullPath] = {}

      const m: RouteMetadata = route.metadata ?? {}
      const baseId = `${ method }_${ fullPath.replace(/\//g, "_") }`
      let operationId = baseId
      let n = 1
      while (opIdSet.has(operationId)) operationId = `${ baseId }_${ n++ }`
      opIdSet.add(operationId)

      const op: any = {
        summary: m.description ?? `Endpoint for ${ method.toUpperCase() } ${ fullPath }`,
        operationId,
        tags: builder.tags?.length ? builder.tags : [rootPath.replace(/\/+/g, " ")],
        responses: {},
        parameters: [],
        deprecated: m.deprecated
      }

      if (m.auth) {
        if (Array.isArray(m.auth))
          op.security = m.auth.map((s) => ({ [s]: [] }))
        else
          op.security = Object.entries(m.auth).map(([k, v]) => ({ [k]: v }))
      }

      if (route.schema) {
        const { query, params, body, headers } = route.schema

        if (headers) {
          const { swagger: hSw, components: comp } = j2s(withClassName(headers))
          collect(comp)
          const { props, required } = resolveProps(hSw)
          if (props)
            Object.keys(props).forEach((name) => {
              const pObj = {
                name: name
                  .split("-")
                  .map((p) => p[0].toUpperCase() + p.slice(1))
                  .join("-"),
                in: "header",
                required: required?.includes(name) ?? false,
                schema: props[name],
                description: props[name].description
              }
              pushParam(pObj, op.parameters)
            })
        }

        if (params) {
          const { swagger: pSw, components: comp } = j2s(withClassName(params))
          collect(comp)
          const { props } = resolveProps(pSw)
          if (props)
            Object.keys(props).forEach((name) => {
              const pObj = {
                name,
                in: "path",
                required: true,
                schema: props[name],
                description:
                  props[name].description ??
                  (route.path.includes(`:${ name }?`) ? "Optional parameter" : "")
              }
              pushParam(pObj, op.parameters)
            })
        }

        if (query) {
          const { swagger: qSw, components: comp } = j2s(withClassName(query))
          collect(comp)
          const { props, required } = resolveProps(qSw)
          if (props)
            Object.keys(props).forEach((name) => {
              const pObj = {
                name,
                in: "query",
                required: required?.includes(name) ?? false,
                schema: props[name],
                description: props[name].description
              }
              pushParam(pObj, op.parameters)
            })
        }

        if (body) {
          const multipart = isMultipart(body as any)
          const { swagger: bSw, components: comp } = j2s(withClassName(body))
          collect(comp)
          const refName = bSw.$ref
            ? String(bSw.$ref).replace(/^#\/components\/schemas\//, "")
            : comp?.schemas
              ? Object.keys(comp.schemas)[0]
              : null
          const ct = multipart ? "multipart/form-data" : "application/json"
          op.requestBody = {
            content: {
              [ct]: {
                schema: refName
                  ? { $ref: `#/components/schemas/${ refName }` }
                  : bSw
              }
            }
          }
        }
      }

      let custom = false;
      (m.responses || []).forEach((Resp: any) => {
        const r = new Resp()
        const hdrs: Record<string, any> = {}
        if (r.headers) {
          Object.entries(r.headers).forEach(([k, v]) => {
            hdrs[k] = {
              description: `Header: ${ k }`,
              schema: { type: typeof v === "string" ? "string" : typeof v }
            }
          })
        }
        if (/^[123]/.test(String(r.code))) {
          custom = true
          const ct = r.headers?.get("content-type") ?? "application/json"
          op.responses[r.code] = {
            description: "Success response",
            headers: Object.keys(hdrs).length ? hdrs : undefined,
            content: {
              [ct]: {
                example: !r.raw
                  ? { error: null, content: r.example ?? "Response content" }
                  : r.example ?? "Response content"
              }
            }
          }
        }
        else if (r.code && r.name) {
          op.responses[r.code] = {
            description: classNameToReadable(r.name),
            headers: Object.keys(hdrs).length ? hdrs : undefined,
            content: {
              "application/json": {
                example: { error: r.name, content: "Error message" }
              }
            }
          }
        }
      })

      if (!custom) {
        op.responses["200"] = {
          description: "Successful response",
          headers: {
            "Content-Type": {
              description: "The content type of the response",
              schema: { type: "string", example: "application/json" }
            }
          },
          content: {
            "application/json": {
              example: { error: null, content: m.example ?? "Response content" }
            }
          }
        }
      }

      paths[fullPath][method] = op
    })
  })

  const doc: any = {
    openapi: "3.0.0",
    info: {
      title: options.title || "API Documentation",
      description: options.description || "Auto-generated Swagger documentation",
      version: options.version || "1.0.0"
    },
    servers: options.servers || [{
      url: "{scheme}://{host}:{port}",
      variables: {
        scheme: { default: "http", enum: ["http", "https"] },
        host: { default: "127.0.0.1" },
        port: { default: "3000" }
      }
    }],
    paths
  }

  if (
    Object.keys(components.schemas).length ||
    Object.keys(components.securitySchemes).length ||
    Object.keys(components.parameters).length
  ) doc.components = components

  return doc
}
