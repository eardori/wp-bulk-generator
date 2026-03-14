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

function strip_review_reference_markers($html) {
  $patterns = array(
    '/\[(?:리뷰|review)\s*#\s*\d+\]/iu',
    '/\((?:리뷰|review)\s*#\s*\d+\)/iu',
    '/[（(][^()（）]*#\s*\d+[^()（）]*[)）]/u',
    '/(?:^|\s)(?:리뷰|review)\s*#\s*\d+(?=[\s,.;:!?)\]]|$)/iu',
    '/(?:,\s*)?#\s*\d+(?:\s*등)?/u',
  );

  return preg_replace($patterns, ' ', $html);
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

function collect_content_lines($html) {
  $lines = array();
  if (preg_match_all('/<(?:li|p|dt|dd|figcaption)[^>]*>(.*?)<\/(?:li|p|dt|dd|figcaption)>/si', $html, $matches)) {
    foreach ($matches[1] as $raw) {
      $text = trim(preg_replace('/\s+/', ' ', wp_strip_all_tags($raw)));
      if ($text !== '') {
        $lines[$text] = $text;
      }
    }
  }

  return array_values($lines);
}

function extract_labeled_value($lines, $labels) {
  foreach ($lines as $line) {
    foreach ($labels as $label) {
      $pattern = '/(?:^|\s)' . preg_quote($label, '/') . '\s*[:：-]?\s*(.+)$/iu';
      if (preg_match($pattern, $line, $match)) {
        $value = trim(preg_replace('/\s+/', ' ', (string) ($match[1] ?? '')));
        if ($value !== '') {
          return $value;
        }
      }
    }
  }

  return '';
}

function infer_cuisine($text) {
  $map = array(
    '/(한식|갈비|국밥|삼겹살|불고기|백반)/iu' => 'Korean',
    '/(일식|스시|초밥|라멘|우동|오마카세)/iu' => 'Japanese',
    '/(중식|짜장|짬뽕|마라|딤섬)/iu' => 'Chinese',
    '/(양식|파스타|스테이크|리조또|브런치)/iu' => 'Western',
    '/(카페|커피|디저트|베이커리|케이크)/iu' => 'Cafe',
    '/(치킨|버거|피자|샌드위치)/iu' => 'Fast Food',
    '/(와인|바|주점|칵테일)/iu' => 'Bar',
  );

  foreach ($map as $pattern => $value) {
    if (preg_match($pattern, $text)) {
      return $value;
    }
  }

  return '';
}

function build_business_schema($post, $content, $title, $excerpt) {
  $plain_text = trim(preg_replace('/\s+/', ' ', wp_strip_all_tags($content)));
  $lines = collect_content_lines($content);
  $address = extract_labeled_value($lines, array('주소', '위치', '지번주소', '도로명주소'));

  if ($address === '' && preg_match('/((?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[^\n,]{6,120})/u', $plain_text, $address_match)) {
    $address = trim($address_match[1]);
  }

  $telephone = extract_labeled_value($lines, array('전화', '전화번호', '문의'));
  if ($telephone !== '' && preg_match('/(0\d{1,2}-\d{3,4}-\d{4})/', $telephone, $tel_match)) {
    $telephone = $tel_match[1];
  } elseif (preg_match('/(0\d{1,2}-\d{3,4}-\d{4})/', $plain_text, $tel_match)) {
    $telephone = $tel_match[1];
  } else {
    $telephone = '';
  }

  $has_place_signals = $address !== '' || $telephone !== '' || preg_match('/(주소|위치|전화|영업시간|찾아가는 길|편의시설|예약)/iu', $plain_text);
  $looks_like_restaurant = preg_match('/(맛집|식당|레스토랑|restaurant|카페|coffee|브런치|갈비|고기|한식|일식|중식|양식|베이커리|디저트|주점|와인|bar|펍|술집)/iu', $title . ' ' . $plain_text);

  if (!$has_place_signals && !$looks_like_restaurant) {
    return null;
  }

  $business_name = trim(preg_replace('/\s*(리뷰|후기|방문기|방문 후기|추천|가이드|총정리|솔직 후기|review).*$/iu', '', preg_replace('/\s*[-:|].*$/u', '', $title)));
  if ($business_name === '') {
    $business_name = $title;
  }

  $image = get_the_post_thumbnail_url($post, 'large');
  if (!$image && preg_match('/<img[^>]*src=["\']([^"\']+)["\']/i', $content, $image_match)) {
    $image = $image_match[1];
  }

  $schema = array(
    '@context' => 'https://schema.org',
    '@type' => $looks_like_restaurant ? 'Restaurant' : 'LocalBusiness',
    'name' => $business_name,
    'description' => mb_substr($excerpt !== '' ? $excerpt : $plain_text, 0, 200),
    'url' => get_permalink($post),
  );

  if ($image) {
    $schema['image'] = $image;
  }

  if ($telephone !== '') {
    $schema['telephone'] = $telephone;
  }

  if ($address !== '') {
    $schema['address'] = array(
      '@type' => 'PostalAddress',
      'streetAddress' => $address,
      'addressCountry' => 'KR',
    );
  }

  if (preg_match('/(\d(?:\.\d)?)\s*(?:점|\/\s*5)/u', $plain_text, $rating_match)) {
    $aggregate = array(
      '@type' => 'AggregateRating',
      'ratingValue' => $rating_match[1],
    );
    if (preg_match('/(?:리뷰|후기)\s*(\d{1,4})\s*개/u', $plain_text, $review_count_match)) {
      $aggregate['reviewCount'] = (int) $review_count_match[1];
    }
    $schema['aggregateRating'] = $aggregate;
  }

  if (preg_match_all('/(\d{1,3}(?:,\d{3})*)\s*원/u', $plain_text, $price_matches)) {
    $prices = array();
    foreach ($price_matches[1] as $raw_price) {
      $price = (int) str_replace(',', '', $raw_price);
      if ($price > 0 && $price < 10000000) {
        $prices[] = $price;
      }
    }
    if (!empty($prices)) {
      sort($prices);
      $schema['priceRange'] = $prices[0] === end($prices)
        ? 'KRW ' . number_format($prices[0])
        : 'KRW ' . number_format($prices[0]) . '-' . number_format(end($prices));
    }
  }

  $cuisine = infer_cuisine($title . ' ' . $plain_text);
  if ($looks_like_restaurant && $cuisine !== '') {
    $schema['servesCuisine'] = $cuisine;
  }

  return $schema;
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

  $business_schema = build_business_schema($post, $content, $title, $excerpt);
  if (!empty($business_schema)) {
    $schema_html .= "\n" . '<script type="application/ld+json">' . wp_json_encode($business_schema, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . '</script>';
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
  $content = improve_image_alts(strip_review_reference_markers($content_without_schemas), $title);

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
