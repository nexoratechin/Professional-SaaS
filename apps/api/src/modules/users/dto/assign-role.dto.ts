import { IsOptional, IsUUID } from 'class-validator';

/** Binds a role assignment to a specific org unit — used whenever the role grants any
 * CAMPUS/DEPARTMENT/PROGRAM-scoped permission (see RolePermission.scopeType). Normally at most
 * one of these is set, matching whichever scope the assignment represents (e.g. a HOD
 * assignment sets departmentId); left to the caller's judgement, not DB-enforced. */
export class AssignRoleDto {
  @IsOptional()
  @IsUUID()
  campusId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  programId?: string;
}
