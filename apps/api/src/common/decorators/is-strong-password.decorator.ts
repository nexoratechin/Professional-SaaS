import { registerDecorator, type ValidationOptions } from 'class-validator';
import { validatePasswordStrength } from '@college-erp/auth';

/** Binds the shared, framework-agnostic password policy (packages/auth) to class-validator so
 * every DTO that accepts a new password (invite, tenant provisioning, reset-password) enforces
 * the same rule set from one place. */
export function IsStrongPassword(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isStrongPassword',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return typeof value === 'string' && validatePasswordStrength(value).length === 0;
        },
        defaultMessage() {
          return (
            'Password does not meet the required policy (minimum length, character diversity, ' +
            'and not a commonly used password).'
          );
        },
      },
    });
  };
}
