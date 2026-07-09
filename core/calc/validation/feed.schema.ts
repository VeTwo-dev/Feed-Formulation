import { z } from "zod";

export const FeedConstraintSchema = z.object({
    maxFraction: z
        .number()
        .min(0)
        .max(1)
        .optional(),

    warningFraction: z
        .number()
        .min(0)
        .max(1)
        .optional(),

    maxKg: z
        .number()
        .positive()
        .optional(),

    warningKg: z
        .number()
        .positive()
        .optional(),

    solver: z
        .enum([
            "none",
            "warning",
            "hard",
        ])
        .optional(),

    warningMessage: z
        .string()
        .optional(),

    recommendation: z
        .string()
        .optional(),
});



export const FeedTypeSchema = z.union([
    z.enum([
        "roughage",
        "protein",
        "energy",
        "mineral",
        "mineral_calcium",
        "mineral_phosphorus",
    ]),

    z.array(
        z.enum([
            "mineral",
            "mineral_calcium",
            "mineral_phosphorus",
        ])
    ),
]);

export const FeedSchema = z.object({

    type: FeedTypeSchema,

    cp: z.number().min(0),

    de: z.number().min(0),

    ca: z.number().min(0),

    p: z.number().min(0),

    price: z.number().positive().optional(),

    constraints:
        FeedConstraintSchema.optional(),

});




export const FeedDatabaseSchema =
    z.record(
        z.string(),
        FeedSchema
    );