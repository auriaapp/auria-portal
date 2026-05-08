export type MTLMaterial = {
    name: string;
    ambientColor?: [number, number, number];
    diffuseColor?: [number, number, number];
    specularColor?: [number, number, number];
    emissiveColor?: [number, number, number];
    shininess?: number;
    refraction?: number;
    illumination?: number;
    diffuseTextureUrl?: string;
    emissiveTextureUrl?: string;
    specularTextureUrl?: string;
};
/**
 * Set of options on how to construct materials
 * @param normalizeRGB: RGBs need to be normalized to 0-1 from 0-255 (Default: false, assumed to be already normalized)
 * @param ignoreZeroRGBs: Ignore values of RGBs (Ka,Kd,Ks) that are all 0's Default: false
 * @param baseUrl - Url relative to which textures are loaded
 */
export type ParseMTLOptions = {
    normalizeRGB?: boolean;
    ignoreZeroRGBs?: boolean;
    baseUrl?: string;
};
/**
 * Parses a MTL file.
 * Parses a Wavefront .mtl file specifying materials
 * http://paulbourke.net/dataformats/mtl/
 * https://www.loc.gov/preservation/digital/formats/fdd/fdd000508.shtml
 *
 * @param  text - Content of MTL file
 */
export declare function parseMTL(text: string, options?: ParseMTLOptions): MTLMaterial[];
//# sourceMappingURL=parse-mtl.d.ts.map