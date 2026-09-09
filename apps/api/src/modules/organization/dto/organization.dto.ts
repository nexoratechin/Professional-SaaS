import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** Every create DTO reuses these validated fields; update DTOs re-declare them optional. */

export class CreateCampusDto {
  @IsString() @MaxLength(50) code!: string;
  @IsString() @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(500) addressLine?: string;
  @IsOptional() @IsString() @MaxLength(100) city?: string;
  @IsOptional() @IsString() @MaxLength(100) state?: string;
  @IsOptional() @IsString() @MaxLength(100) country?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateCampusDto {
  @IsOptional() @IsString() @MaxLength(50) code?: string;
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(500) addressLine?: string;
  @IsOptional() @IsString() @MaxLength(100) city?: string;
  @IsOptional() @IsString() @MaxLength(100) state?: string;
  @IsOptional() @IsString() @MaxLength(100) country?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateDepartmentDto {
  @IsOptional() @IsString() campusId?: string; // null/omitted => top-level department
  @IsString() @MaxLength(50) code!: string;
  @IsString() @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateDepartmentDto {
  @IsOptional() @IsString() campusId?: string;
  @IsOptional() @IsString() @MaxLength(50) code?: string;
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateProgramDto {
  @IsOptional() @IsString() departmentId?: string;
  @IsString() @MaxLength(50) code!: string;
  @IsString() @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(100) degreeLevel?: string;
  @IsOptional() @IsInt() @Min(1) durationYears?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateProgramDto {
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() @MaxLength(50) code?: string;
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(100) degreeLevel?: string;
  @IsOptional() @IsInt() @Min(1) durationYears?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateAcademicYearDto {
  @IsString() @MaxLength(50) code!: string;
  @IsString() @MaxLength(200) name!: string;
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
  @IsOptional() @IsBoolean() isCurrent?: boolean;
}

export class UpdateAcademicYearDto {
  @IsOptional() @IsString() @MaxLength(50) code?: string;
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsBoolean() isCurrent?: boolean;
}

export class CreateTermDto {
  @IsString() academicYearId!: string;
  @IsString() @MaxLength(50) code!: string;
  @IsString() @MaxLength(200) name!: string;
  @IsOptional() @IsInt() @Min(1) sequence?: number;
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
  @IsOptional() @IsBoolean() isCurrent?: boolean;
}

export class UpdateTermDto {
  @IsOptional() @IsString() academicYearId?: string;
  @IsOptional() @IsString() @MaxLength(50) code?: string;
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsInt() @Min(1) sequence?: number;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsBoolean() isCurrent?: boolean;
}

const ROOM_TYPES = ['CLASSROOM', 'LABORATORY', 'SEMINAR_HALL', 'AUDITORIUM', 'LIBRARY', 'OFFICE', 'OTHER'] as const;

export class CreateRoomDto {
  @IsString() campusId!: string;
  @IsOptional() @IsString() buildingId?: string;
  @IsString() @MaxLength(50) code!: string;
  @IsString() @MaxLength(200) name!: string;
  @IsOptional() @IsIn(ROOM_TYPES) roomType?: (typeof ROOM_TYPES)[number];
  @IsOptional() @IsInt() @Min(1) capacity?: number;
  @IsOptional() @IsString() @MaxLength(200) buildingName?: string;
  @IsOptional() @IsString() @MaxLength(50) floor?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateRoomDto {
  @IsOptional() @IsString() campusId?: string;
  @IsOptional() @IsString() buildingId?: string;
  @IsOptional() @IsString() @MaxLength(50) code?: string;
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsIn(ROOM_TYPES) roomType?: (typeof ROOM_TYPES)[number];
  @IsOptional() @IsInt() @Min(1) capacity?: number;
  @IsOptional() @IsString() @MaxLength(200) buildingName?: string;
  @IsOptional() @IsString() @MaxLength(50) floor?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateBuildingDto {
  @IsString() campusId!: string;
  @IsString() @MaxLength(50) code!: string;
  @IsString() @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(500) addressLine?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateBuildingDto {
  @IsOptional() @IsString() campusId?: string;
  @IsOptional() @IsString() @MaxLength(50) code?: string;
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(500) addressLine?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateSectionDto {
  @IsString() programId!: string;
  @IsOptional() @IsString() academicYearId?: string;
  @IsString() @MaxLength(50) code!: string;
  @IsString() @MaxLength(200) name!: string;
  @IsOptional() @IsInt() @Min(1) capacity?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateSectionDto {
  @IsOptional() @IsString() programId?: string;
  @IsOptional() @IsString() academicYearId?: string;
  @IsOptional() @IsString() @MaxLength(50) code?: string;
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsInt() @Min(1) capacity?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateBatchDto {
  @IsString() programId!: string;
  @IsOptional() @IsString() academicYearId?: string;
  @IsString() @MaxLength(50) code!: string;
  @IsString() @MaxLength(200) name!: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateBatchDto {
  @IsOptional() @IsString() programId?: string;
  @IsOptional() @IsString() academicYearId?: string;
  @IsOptional() @IsString() @MaxLength(50) code?: string;
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}