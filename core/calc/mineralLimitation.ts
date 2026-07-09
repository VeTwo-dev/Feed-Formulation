import limits from "../data/mineralLimits.json";
import { AnimalMineralLimits, FeedData, MineralLimitsDatabase } from "./forceDynamicFormulation";

const mineralLimits =
limits as MineralLimitsDatabase;

export function getMineralLimits(
    species: string
): AnimalMineralLimits {

    const data = mineralLimits[species];

    if (!data) {
        throw new Error(
            `No mineral limits found for ${species}`
        );
    }

    return data;
}



export function isMineral(fd: FeedData){

    if(Array.isArray(fd.type))
        return fd.type.some(t=>t.startsWith("mineral"));

    return (
    fd.type === "mineral" ||
    fd.type.startsWith("mineral")
);
}
