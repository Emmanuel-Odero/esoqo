@extends('layouts.app')

{{--
  No @include('partials.page-header') here — every CECF page's own
  `phead` (or, on the homepage, `hero`) section already renders the page
  title, styled per the approved design; Sage's stock plain <h1> partial
  would just duplicate it above that on every single page.
--}}
@section('content')
  @while(have_posts()) @php(the_post())
    @includeFirst(['partials.content-page', 'partials.content'])
  @endwhile
@endsection
