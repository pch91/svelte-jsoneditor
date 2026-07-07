import { ValidationSeverity, type ContentErrors, type ValidationError } from '$lib/types.js'
import { stringifyJSONPath } from '$lib/utils/pathUtils.js'
import type { JSONPath } from 'immutable-json-patch'

export interface Problem {
  path: JSONPath
  pathLabel: string
  message: string
  severity: ValidationError['severity']
}

/**
 * Flatten the content errors returned by JSONEditor.validate() into a
 * list of problems suitable for the Problems panel.
 */
export function contentErrorsToProblems(errors: ContentErrors | undefined): Problem[] {
  if (!errors) return []

  if ('validationErrors' in errors) {
    return errors.validationErrors.map((error) => ({
      path: error.path,
      pathLabel: stringifyJSONPath(error.path),
      message: error.message,
      severity: error.severity
    }))
  }

  return [
    {
      path: [],
      pathLabel: '',
      message: errors.parseError.message,
      severity: ValidationSeverity.error
    }
  ]
}
