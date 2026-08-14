{{--
  The `.reqs` list markup only — shared by partials/cecf/requirementList.blade.php
  (standalone section) and twoColumn.blade.php (requirementList embedded
  alongside prose, e.g. findus.json/contact.json), so the two don't carry
  two copies of the same loop.

  Expects $items: [{status, title, body, highlight?}].
--}}
<div class="reqs">
  @foreach ($items as $req)
    <div class="rq {{ ($req['status'] ?? 'done') === 'optional' ? 'opt' : 'done' }}">
      <x-icon :name="($req['status'] ?? 'done') === 'optional' ? 'info-circle' : 'check-circle'" />
      <div>
        <strong>{{ $req['title'] ?? '' }}</strong>
        @if (! empty($req['highlight']))
          <span class="mono">{{ $req['highlight'] }}</span>
        @endif
        <span>{!! \App\Support\Markdown::inline($req['body'] ?? '') !!}</span>
      </div>
    </div>
  @endforeach
</div>
