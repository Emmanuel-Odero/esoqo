@props([
  'name',
  'size' => 20,
])

{!! \App\Support\Icon::tag($name, array_filter([$attributes->get('class')]), $size) !!}
