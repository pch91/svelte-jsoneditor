import { describe, expect, it } from 'vitest'
import { ValidationSeverity, type ContentErrors } from '$lib/types.js'
import { contentErrorsToProblems } from './problemsUtils.js'

describe('problemsUtils', () => {
  it('returns an empty list when there are no errors', () => {
    expect(contentErrorsToProblems(undefined)).toEqual([])
  })

  it('maps validation errors to problems with a path label', () => {
    const errors: ContentErrors = {
      validationErrors: [
        { path: ['user', 'age'], message: 'must be number', severity: ValidationSeverity.error },
        { path: ['tags'], message: 'should not be empty', severity: ValidationSeverity.warning }
      ]
    }

    const problems = contentErrorsToProblems(errors)

    expect(problems.length).toBe(2)
    expect(problems[0]).toEqual({
      path: ['user', 'age'],
      pathLabel: 'user.age',
      message: 'must be number',
      severity: ValidationSeverity.error
    })
    expect(problems[1].pathLabel).toBe('tags')
  })

  it('maps a parse error to a single error problem', () => {
    const errors: ContentErrors = {
      parseError: {
        position: 2,
        line: 1,
        column: 3,
        message: 'Unexpected end of JSON input'
      },
      isRepairable: false
    }

    const problems = contentErrorsToProblems(errors)

    expect(problems.length).toBe(1)
    expect(problems[0].message).toContain('Unexpected')
    expect(problems[0].path).toEqual([])
    expect(problems[0].pathLabel).toBe('')
    expect(problems[0].severity).toBe(ValidationSeverity.error)
  })
})
