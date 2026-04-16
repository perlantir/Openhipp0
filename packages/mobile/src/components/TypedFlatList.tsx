// packages/mobile/src/components/TypedFlatList.tsx
// Thin wrapper around React Native's FlatList that forwards the generic
// type through renderItem cleanly under our strict tsconfig
// (noUncheckedIndexedAccess + strict). Using the bare FlatList<T> forces
// callers to annotate `({ item }: ListRenderItemInfo<T>)` at every site;
// this wrapper centralises it so screens stay readable.

import { FlatList, type FlatListProps, type ListRenderItemInfo } from "react-native";

export interface TypedFlatListProps<T> extends Omit<FlatListProps<T>, "renderItem"> {
  renderItem: (info: ListRenderItemInfo<T>) => ReturnType<NonNullable<FlatListProps<T>["renderItem"]>>;
}

export function TypedFlatList<T>(props: TypedFlatListProps<T>) {
  return <FlatList<T> {...props} />;
}
