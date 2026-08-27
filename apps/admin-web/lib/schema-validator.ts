import type { ErrorObject, ValidateFunction } from "ajv";
import {
  validateDescriptorAjv as _validateDescriptorAjv,
  validateGameReleaseSourceAjv as _validateGameReleaseSourceAjv,
} from "./generated/schema-validators.js";
import descriptorSchema from "../../../packages/contracts/schemas/deployment-artifact-descriptor.schema.json" with { type: "json" };
import gameReleaseSourceSchema from "../../../packages/contracts/schemas/game-release-source.schema.json" with { type: "json" };

export const validateDescriptorAjv = _validateDescriptorAjv as ValidateFunction;
export const validateGameReleaseSourceAjv = _validateGameReleaseSourceAjv as ValidateFunction;

export { descriptorSchema, gameReleaseSourceSchema };
export type { ErrorObject, ValidateFunction };
