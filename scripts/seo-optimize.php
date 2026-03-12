<?php
/**
 * GEO 최적화 PHP 스크립트 — wp eval-file로 실행
 * 사용법: wp eval-file /home/ubuntu/wp-bulk-generator/scripts/seo-optimize.php --allow-root --path=/var/www/SITE_DIR
 *
 * 인자:
 *   $args[0] = persona 이름
 *   $args[1] = 사이트 제목
 *   $args[2] = persona expertise
 *   $args[3] = persona concern
 *   $args[4] = persona bio
 */

$persona_name = $args[0] ?? get_bloginfo('name');
$site_title = $args[1] ?? get_bloginfo('name');
$persona_expertise = $args[2] ?? '';
$persona_concern = $args[3] ?? '';
$persona_bio = $args[4] ?? '';

function strip_json_ld_scripts($html) {
  return trim((string) preg_replace(
    '/\s*<script[^>]*type=["\']application\/ld\+json["\'][^>]*>[\s\S]*?<\/script>\s*/i',
    "\n",
    $html
  ));
}

function jsonld_signature($html) {
  if (!preg_match_all('/<script[^>]*type=["\']application\/ld\+json["\'][^>]*>([\s\S]*?)<\/script>/i', $html, $matches)) {
    return '';
  }

  $chunks = array();
  foreach ($matches[1] as $raw) {
    $raw = trim((string) $raw);
    if ($raw === '') continue;
    $decoded = json_decode($raw, true);
    $chunks[] = $decoded !== null
      ? wp_json_encode($decoded, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
      : preg_replace('/\s+/', ' ', $raw);
  }

  return implode("\n", $chunks);
}

function normalize_html_signature($html) {
  return trim((string) preg_replace('/\s+/', ' ', $html));
}

function improve_image_alts($html, $title) {
  $counter = 0;

  $html = preg_replace_callback('/<img\b([^>]*?)>/i', function ($matches) use ($title, &$counter) {
    $attrs = $matches[1];
    $current_alt = '';

    if (preg_match('/alt="([^"]*)"/i', $attrs, $alt_match)) {
      $current_alt = $alt_match[1];
    }

    $is_generic = $current_alt === ''
      || $current_alt === '실제 구매자 리뷰 사진'
      || $current_alt === 'image'
      || mb_strlen($current_alt) < 3;

    if (!$is_generic) {
      return $matches[0];
    }

    $counter++;
    $new_alt = esc_attr($title . ' 관련 이미지 ' . $counter);
    if (preg_match('/alt="[^"]*"/i', $attrs)) {
      $attrs = preg_replace('/alt="[^"]*"/i', 'alt="' . $new_alt . '"', $attrs);
    } else {
      $attrs = 'alt="' . $new_alt . '" ' . ltrim($attrs);
    }

    return '<img ' . trim($attrs) . '>';
  }, $html);

  return preg_replace(
    '/<figcaption[^>]*>\s*(실제 구매자 리뷰 사진)?\s*<\/figcaption>/i',
    '<figcaption>' . esc_html($title . ' 실제 사용 사진') . '</figcaption>',
    $html
  );
}

function extract_faq_items($html) {
  $faq_items = array();

  if (preg_match_all('/<dt[^>]*>(.*?)<\/dt>\s*<dd[^>]*>(.*?)<\/dd>/si', $html, $matches, PREG_SET_ORDER)) {
    foreach ($matches as $m) {
      $q = wp_strip_all_tags($m[1]);
      $a = wp_strip_all_tags($m[2]);
      if ($q !== '' && mb_strlen($a) > 20) {
        $faq_items[] = array(
          '@type' => 'Question',
          'name' => $q,
          'acceptedAnswer' => array('@type' => 'Answer', 'text' => mb_substr($a, 0, 300)),
        );
      }
    }
  }

  if (empty($faq_items) && preg_match_all('/<h3[^>]*>(.*?)<\/h3>\s*<p[^>]*>(.*?)<\/p>/si', $html, $matches, PREG_SET_ORDER)) {
    foreach ($matches as $m) {
      $q = wp_strip_all_tags($m[1]);
      $a = wp_strip_all_tags($m[2]);
      if ((mb_strpos($q, '?') !== false || mb_strpos($q, '？') !== false) && mb_strlen($a) > 20) {
        $faq_items[] = array(
          '@type' => 'Question',
          'name' => $q,
          'acceptedAnswer' => array('@type' => 'Answer', 'text' => mb_substr($a, 0, 300)),
        );
      }
    }
  }

  if (empty($faq_items) && preg_match_all('/<p[^>]*>[\s\S]*?<strong>(.*?\?.*?)<\/strong>[\s\S]*?<\/p>\s*<p[^>]*>(.*?)<\/p>/si', $html, $matches, PREG_SET_ORDER)) {
    foreach ($matches as $m) {
      $q = wp_strip_all_tags($m[1]);
      $a = wp_strip_all_tags($m[2]);
      if (mb_strlen($a) > 20) {
        $faq_items[] = array(
          '@type' => 'Question',
          'name' => $q,
          'acceptedAnswer' => array('@type' => 'Answer', 'text' => mb_substr($a, 0, 300)),
        );
      }
    }
  }

  return array_slice($faq_items, 0, 10);
}

function build_schema_html($post, $content, $title, $excerpt, $persona_name, $site_title, $persona_expertise, $persona_concern, $persona_bio) {
  $author = array(
    '@type' => 'Person',
    'name' => $persona_name,
  );

  if ($persona_expertise !== '') $author['jobTitle'] = $persona_expertise . ' 리뷰어';
  if ($persona_concern !== '') $author['knowsAbout'] = $persona_concern;
  if ($persona_bio !== '') $author['description'] = $persona_bio;

  $article_schema = array(
    '@context' => 'https://schema.org',
    '@type' => 'Article',
    'headline' => $title,
    'description' => $excerpt,
    'author' => $author,
    'datePublished' => $post->post_date,
    'dateModified' => $post->post_modified,
    'publisher' => array('@type' => 'Organization', 'name' => $site_title),
    'speakable' => array(
      '@type' => 'SpeakableSpecification',
      'cssSelector' => array('.summary-box', 'h2'),
    ),
    'url' => get_permalink($post),
  );

  $schema_html = "\n" . '<script type="application/ld+json">' . wp_json_encode($article_schema, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . '</script>';

  $faq_items = extract_faq_items($content);
  if (!empty($faq_items)) {
    $faq_schema = array(
      '@context' => 'https://schema.org',
      '@type' => 'FAQPage',
      'mainEntity' => $faq_items,
    );
    $schema_html .= "\n" . '<script type="application/ld+json">' . wp_json_encode($faq_schema, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . '</script>';
  }

  return array($schema_html, count($faq_items));
}

$updated = 0;
$skipped = 0;
$errors = 0;

$posts = get_posts(array(
  'post_type' => 'post',
  'post_status' => 'publish',
  'numberposts' => -1,
));

foreach ($posts as $post) {
  $title = wp_strip_all_tags($post->post_title);
  $short = mb_substr($title, 0, 35);
  $original_content = (string) $post->post_content;
  $content_without_schemas = strip_json_ld_scripts($original_content);
  $content = improve_image_alts($content_without_schemas, $title);

  $excerpt = wp_strip_all_tags($post->post_excerpt ?: wp_trim_words($content, 30, ''));
  $excerpt = mb_substr($excerpt, 0, 160);

  list($schema_html, $faq_count) = build_schema_html(
    $post,
    $content,
    $title,
    $excerpt,
    $persona_name,
    $site_title,
    $persona_expertise,
    $persona_concern,
    $persona_bio
  );

  $current_schema_signature = jsonld_signature($original_content);
  $desired_schema_signature = jsonld_signature($schema_html);
  $content_unchanged = normalize_html_signature($content_without_schemas) === normalize_html_signature($content);

  if ($content_unchanged && $current_schema_signature === $desired_schema_signature) {
    $skipped++;
    echo "  ⏭ #{$post->ID} \"{$short}...\" (최신 GEO 적용됨)\n";
    continue;
  }

  $new_content = $content . $schema_html;
  $result = wp_update_post(array(
    'ID' => $post->ID,
    'post_content' => $new_content,
  ), true);

  if (is_wp_error($result)) {
    $errors++;
    echo "  ❌ #{$post->ID} \"{$short}...\" — " . $result->get_error_message() . "\n";
    continue;
  }

  update_post_meta($post->ID, '_yoast_wpseo_title', mb_substr($title, 0, 60));
  update_post_meta($post->ID, '_yoast_wpseo_metadesc', mb_substr($excerpt, 0, 155));

  $updated++;
  $faq_label = $faq_count > 0 ? " + FAQ({$faq_count})" : '';
  echo "  ✅ #{$post->ID} \"{$short}...\" — GEO{$faq_label} + Yoast\n";
}

echo "\nRESULT:{$updated}:{$skipped}:{$errors}\n";
