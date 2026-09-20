import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

const ITEM_TYPES = ['BASE', 'PER_STUDENT', 'PER_CAMPUS', 'ADDON_MODULE', 'CUSTOM'] as const;

export class AddSubscriptionItemDto {
  @IsIn(ITEM_TYPES)
  itemType!: (typeof ITEM_TYPES)[number];

  @IsString()
  description!: string;

  /** Only meaningful for ADDON_MODULE/CUSTOM items that should grant an entitlement — see
   * SubscriptionItem's doc comment in schema.prisma. Left unset for pure billing quantities
   * (BASE/PER_STUDENT/PER_CAMPUS). */
  @IsOptional()
  @IsString()
  moduleKey?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsInt()
  @Min(0)
  unitPriceCents!: number;

  @IsOptional()
  @IsString()
  currency?: string;
}
