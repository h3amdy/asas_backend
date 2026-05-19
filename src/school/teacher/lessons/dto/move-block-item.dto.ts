import { IsNotEmpty, IsString, IsInt, Min } from 'class-validator';

export class MoveBlockItemDto {
    @IsString()
    @IsNotEmpty()
    targetBlockUuid: string;

    @IsInt()
    @Min(1)
    targetOrderIndex: number;
}
