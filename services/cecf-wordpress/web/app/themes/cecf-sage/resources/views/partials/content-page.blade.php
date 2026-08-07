@foreach ($cecfSections as $section)
  @includeFirst(["partials.cecf.{$section['type']}", 'partials.cecf.missing'], ['data' => $section['data'], 'label' => $section['label']])
@endforeach

@if ($pagination())
  <nav class="page-nav" aria-label="Page">
    {!! $pagination !!}
  </nav>
@endif
