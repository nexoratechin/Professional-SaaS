import { IsIn, IsString, MinLength } from 'class-validator';
import type { BrandingAssetKind } from '@college-erp/types';

const ASSET_KINDS: readonly BrandingAssetKind[] = ['logo', 'favicon', 'loginBackground'];

/** Request a presigned PUT URL for a branding asset (logo / favicon / login background). */
export class RequestBrandingAssetUploadDto {
  @IsIn(ASSET_KINDS)
  kind!: BrandingAssetKind;

  @IsString()
  @MinLength(1)
  filename!: string;

  /** Image MIME type — validated against the allowlist by the service. */
  @IsString()
  @MinLength(1)
  mimeType!: string;
}

/** Confirm that a previously-requested branding asset finished uploading. */
export class ConfirmBrandingAssetDto {
  @IsString()
  @MinLength(1)
  storageKey!: string;
}

/** Route param guard for the asset kind. */
export class BrandingAssetKindParamDto {
  @IsIn(ASSET_KINDS)
  kind!: BrandingAssetKind;
}
