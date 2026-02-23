/**
 * Agent type definitions
 */
export interface Agent {
    id: string;
    name: string;
    description: string;
    instructions: string;
    model: string;
    skills: string[];
    enabled: boolean;
    isDefault: boolean;
}
