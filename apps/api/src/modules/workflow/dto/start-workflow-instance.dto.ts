import { IsObject, IsOptional, IsString } from 'class-validator';

export class StartWorkflowInstanceDto {
  @IsString()
  entityType!: string;

  @IsString()
  entityId!: string;

  /** Arbitrary snapshot used for condition evaluation and approver-scope resolution — e.g.
   * { amount: 5000, departmentId: '...' }. See WorkflowInstance.context's doc comment. */
  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;
}
