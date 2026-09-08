import { IsIn, IsOptional, IsString } from 'class-validator';

const DECISIONS = ['APPROVE', 'REJECT'] as const;

export class DecideTaskDto {
  @IsIn(DECISIONS)
  decision!: (typeof DECISIONS)[number];

  @IsOptional()
  @IsString()
  comment?: string;
}
