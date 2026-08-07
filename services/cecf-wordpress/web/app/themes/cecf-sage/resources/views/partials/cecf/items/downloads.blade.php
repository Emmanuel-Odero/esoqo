{{--
  The `.dlist` markup only — shared by partials/cecf/downloadList.blade.php
  (standalone, unused by current seed content but built for completeness)
  and twoColumn.blade.php (reports.json embeds its downloadList alongside
  prose).

  Expects $items: [{title, meta, tag?}].
--}}
<div class="dlist">
  @foreach ($items as $download)
    <div class="dl">
      <x-icon name="document" />
      <div>
        <strong>{{ $download['title'] ?? '' }}</strong>
        <span>{{ $download['meta'] ?? '' }}</span>
      </div>
      @if (! empty($download['tag']))
        <span class="dltag">{{ $download['tag'] }}</span>
      @endif
    </div>
  @endforeach
</div>
