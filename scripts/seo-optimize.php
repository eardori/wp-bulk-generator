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

function is_placeholder_telephone($telephone) {
  return (bool) preg_match('/(?:1234-5678|0000-0000|1111-1111|9999-9999)/', (string) $telephone);
}

function is_review_keyword_tag($tag_name) {
  $tag_name = trim((string) $tag_name);
  if ($tag_name === '') {
    return false;
  }

  $patterns = array(
    '/(?:맛있어요|좋아요|멋져요|친절해요|깔끔해요|깨끗해요|신선해요|넓어요|아늑해요|편해요|편리해요|특별해요|훌륭해요|세련됐어요|고급스러워요|만족스러워요)$/u',
    '/(?:음식|고기\s*질|서비스|인테리어|매장|분위기|재료|양|가성비|주차|좌석|화장실|반찬|소스|직원|응대|룸|공간).*(?:맛있어요|좋아요|멋져요|친절해요|깔끔해요|깨끗해요|신선해요|넓어요|아늑해요|편해요|편리해요|특별해요|훌륭해요|세련됐어요|고급스러워요|만족스러워요)$/u',
  );

  foreach ($patterns as $pattern) {
    if (preg_match($pattern, $tag_name)) {
      return true;
    }
  }

  return false;
}

function cleanup_uncertain_place_info_rows($html) {
  $row_patterns = array(
    '/<tr[^>]*>[\s\S]*?(?:전화번호|전화|문의)[\s\S]*?<\/tr>/iu',
    '/<tr[^>]*>[\s\S]*?주차[\s\S]*?<\/tr>/iu',
    '/<tr[^>]*>[\s\S]*?예약[\s\S]*?<\/tr>/iu',
    '/<tr[^>]*>[\s\S]*?영업시간[\s\S]*?(?:확인 필요|직접 확인 필요|가게 직접 확인 필요|문의 필요|정보 부족)[\s\S]*?<\/tr>/iu',
  );

  foreach ($row_patterns as $pattern) {
    $html = preg_replace($pattern, '', $html);
  }

  return $html;
}

function cleanup_uncertain_faq_blocks($html) {
  $block_patterns = array(
    '/<div[^>]*>[\s\S]*?<strong>\s*Q\d+:\s*[^<]*(?:주차|콜키지|전화|예약)[\s\S]*?<\/div>/iu',
    '/<div[^>]*>[\s\S]*?방문 전\s*가게에\s*직접\s*문의[\s\S]*?<\/div>/iu',
    '/<dt[^>]*>[\s\S]*?(?:주차|전화|예약|콜키지)[\s\S]*?<\/dt>\s*<dd[^>]*>[\s\S]*?<\/dd>/iu',
  );

  foreach ($block_patterns as $pattern) {
    $html = preg_replace($pattern, '', $html);
  }

  return $html;
}

function cleanup_empty_html_blocks($html) {
  $patterns = array(
    '/<p[^>]*>\s*(?:<em[^>]*>\s*)?<\/p>/iu',
    '/<li[^>]*>\s*<\/li>/iu',
    '/<div[^>]*>\s*<\/div>/iu',
    '/<dt[^>]*>\s*<\/dt>\s*<dd[^>]*>\s*<\/dd>/iu',
    '/<dt[^>]*>[\s\S]*?<\/dt>\s*<dd[^>]*>\s*A:\s*[^<]{0,20}<\/dd>/iu',
    '/<tr[^>]*>\s*<td[^>]*>[\s\S]*?<\/td>\s*<td[^>]*>\s*(?:A:\s*)?[\s()\-]*<\/td>\s*<\/tr>/iu',
    '/<tbody[^>]*>\s*<\/tbody>/iu',
    '/<table[^>]*>\s*(?:<thead[^>]*>[\s\S]*?<\/thead>)?\s*<\/table>/iu',
  );

  foreach ($patterns as $pattern) {
    $html = preg_replace($pattern, '', $html);
  }

  $html = preg_replace('/\s{2,}/u', ' ', $html);
  $html = preg_replace('/>\s+</', '><', $html);

  return trim((string) $html);
}

function cleanup_review_analysis_sections($html) {
  $html = (string) $html;

  $section_patterns = array(
    '/<h[23][^>]*>\s*[^<]*(?:리뷰\s*데이터로\s*선정한\s*베스트\s*메뉴\s*선정\s*기준|베스트\s*메뉴\s*선정\s*기준|리뷰\s*기반\s*베스트\s*메뉴\s*추천)[^<]*<\/h[23]>\s*(?:(?:<p|<ul|<ol|<div)[\s\S]*?(?:<\/p>|<\/ul>|<\/ol>|<\/div>)\s*){0,5}/iu',
    '/<p[^>]*>\s*<strong>\s*(?:리뷰\s*데이터로\s*선정한\s*베스트\s*메뉴\s*선정\s*기준|베스트\s*메뉴\s*선정\s*기준|리뷰\s*기반\s*베스트\s*메뉴\s*추천)\s*<\/strong>\s*<\/p>\s*(?:(?:<p|<ul|<ol|<div)[\s\S]*?(?:<\/p>|<\/ul>|<\/ol>|<\/div>)\s*){0,5}/iu',
  );

  foreach ($section_patterns as $pattern) {
    $html = preg_replace($pattern, '', $html);
  }

  $block_patterns = array(
    '/<p[^>]*>[\s\S]*?총\s*\d+\s*개(?:의)?\s*리뷰\s*데이터[\s\S]*?<\/p>/iu',
    '/<p[^>]*>[\s\S]*?방문자들이\s*공통적으로\s*언급[\s\S]*?<\/p>/iu',
    '/<p[^>]*>[\s\S]*?키워드가\s*상위권[\s\S]*?<\/p>/iu',
    '/<p[^>]*>[\s\S]*?식사\s*경험의\s*만족도[\s\S]*?<\/p>/iu',
    '/<p[^>]*>[\s\S]*?최적의\s*메뉴\s*조합[\s\S]*?<\/p>/iu',
    '/<p[^>]*>[\s\S]*?\d+\s*(?:개|건)의?\s*(?:네이버\s*(?:방문자\s*)?리뷰|블로그\s*리뷰)[\s\S]*?(?:음식이\s*맛있어요|고기\s*질이\s*좋아요|친절해요|인테리어가\s*멋져요)\s*\(\d+\s*(?:건)?\)[\s\S]*?<\/p>/iu',
    '/<p[^>]*>[\s\S]*?(?:음식이\s*맛있어요|고기\s*질이\s*좋아요|친절해요|인테리어가\s*멋져요)\s*\(\d+\s*(?:건)?\)[\s\S]*?<\/p>/iu',
    '/<div[^>]*>[\s\S]*?(?:음식이\s*맛있어요|고기\s*질이\s*좋아요|친절해요|인테리어가\s*멋져요)\s*\(\d+\s*(?:건)?\)[\s\S]*?<\/div>/iu',
    '/<ul[^>]*>[\s\S]*?(?:음식이\s*맛있어요|고기\s*질이\s*좋아요|친절해요|인테리어가\s*멋져요)\s*\(\d+\s*(?:건)?\)[\s\S]*?<\/ul>/iu',
    '/<ol[^>]*>[\s\S]*?(?:음식이\s*맛있어요|고기\s*질이\s*좋아요|친절해요|인테리어가\s*멋져요)\s*\(\d+\s*(?:건)?\)[\s\S]*?<\/ol>/iu',
    '/<li[^>]*>[\s\S]*?(?:음식이\s*맛있어요|고기\s*질이\s*좋아요|친절해요|인테리어가\s*멋져요)\s*\(\d+\s*(?:건)?\)[\s\S]*?<\/li>/iu',
  );

  foreach ($block_patterns as $pattern) {
    $html = preg_replace($pattern, '', $html);
  }

  return $html;
}

function cleanup_existing_post_language($html) {
  $html = (string) $html;

  $direct_replacements = array(
    '이번 리뷰에서는 직접 경험한 메뉴 구성과 가격, 그리고 방문 팁까지 상세하게 정리했습니다.' => '이 글에서는 메뉴 구성과 가격, 그리고 방문 정보를 정리했습니다.',
    '리뷰를 기반으로 파악된 주요 메뉴와 예상 가격대는 다음과 같습니다.' => '리뷰에서 반복적으로 언급된 주요 메뉴와 가격대는 다음과 같습니다.',
    '리뷰에 따르면' => '리뷰에서는',
    '리뷰 에 따르면' => '리뷰에서는',
    '예상 가격대' => '가격대',
  );

  $html = str_replace(array_keys($direct_replacements), array_values($direct_replacements), $html);

  $regex_replacements = array(
    '/<p[^>]*>\s*<em>\s*\(참고:\s*위 가격은 실제 방문 시 변동될 수 있으며,\s*리뷰 기반 추정치입니다\.\)\s*<\/em>\s*<\/p>/iu' => '',
    '/처음 방문자 추천 조합\s*&\s*피해야 할 메뉴/u' => '처음 방문자 추천 조합',
    '/직접 경험한\s*/u' => '',
    '/직접 방문(?:한|하여|해서)?\s*/u' => '',
    '/리뷰\s*기반\s*추정치(?:입니다)?/u' => '',
    '/리뷰상/u' => '',
    '/많은\s*방문자들이\s*공통적으로\s*언급하듯,?\s*/u' => '',
    '/방문자들이\s*공통적으로\s*언급하듯,?\s*/u' => '',
    '/많은\s*리뷰(?:에서|를\s*보면)\s*언급하듯,?\s*/u' => '',
    '/리뷰(?:에서|를\s*보면)\s*언급하듯,?\s*/u' => '',
    '/많은\s*리뷰(?:에서|를\s*보면)\s*반복적으로\s*언급되듯,?\s*/u' => '',
    '/리뷰(?:에서|를\s*보면)\s*반복적으로\s*언급되듯,?\s*/u' => '',
    '/후기(?:에서|를\s*보면)\s*자주\s*언급되듯,?\s*/u' => '',
    '/추정/u' => '',
    '/현장 기준,\s*/u' => '',
    '/[（(]\s*현장\s*기준\s*[)）]/u' => '',
    '/현장\s*기준/u' => '',
    '/예상하시면 됩니다\./u' => '입니다.',
    '/예상해야 합니다\./u' => '입니다.',
    '/실제로\s*점심시간에\s*[^<.]*?할인(?:을|이)\s*제공하는\s*경우도\s*있어[^<.]*\./u' => '갈비탕은 식사 메뉴로 자주 언급됩니다.',
    '/방문 전\s*가게에\s*직접\s*문의하여\s*정확한\s*주차\s*정보를\s*확인하는\s*것이\s*좋습니다\./u' => '',
    '/방문 전\s*매장에\s*문의하시는\s*것이\s*좋습니다\./u' => '',
    '/가능한\s*것으로\s*보이나[^<.]*\./u' => '',
    '/정보\s*부족\s*-\s*문의\s*필요/u' => '',
    '/[（(]\s*정확한\s*가격(?:\s*정보)?(?:는)?\s*방문\s*(?:문의|확인)\s*필요\s*[)）]/u' => '',
    '/[（(]\s*정확한\s*마감\s*시간(?:은)?\s*확인\s*필요\s*[)）]/u' => '',
    '/[（(]\s*발렛파킹\s*가능\s*여부\s*별도\s*확인\s*필요\s*[)）]/u' => '',
    '/[（(][^()（）]{0,120}(?:확인\s*필요|문의\s*필요)[^()（）]{0,120}[)）]/u' => '',
    '/\s*\(단,\s*일부\s*제한이\s*있을\s*수\s*있으니\s*방문\s*전\s*확인\s*필요\)\s*/u' => '',
    '/창밖\s*뷰가\s*좋은\s*좌석을\s*미리\s*요청하는\s*것도\s*좋은\s*팁입니다\./u' => '',
    '/피해야\s*할\s*메뉴를\s*특정하기는\s*어렵지만[^<.]*\./u' => '',
    '/[（(]\s*리뷰상\s*정보\s*확인\s*필요\s*[)）]/u' => '',
    '/리뷰상\s*정보\s*확인\s*필요/u' => '',
    '/[（(]\s*가게\s*직접\s*확인\s*필요\s*[)）]/u' => '',
    '/[（(]\s*확인\s*필요\s*[)）]/u' => '',
    '/[（(]\s*문의\s*필요\s*[)）]/u' => '',
    '/[（(]\s*직접\s*확인\s*필요\s*[)）]/u' => '',
    '/[（(]\s*[)）]/u' => '',
  );

  foreach ($regex_replacements as $pattern => $replacement) {
    $html = preg_replace($pattern, $replacement, $html);
  }

  $line_segment_patterns = array(
    '/<strong>\s*(?:전화번호|전화|주차|예약)\s*:\s*<\/strong>.*?(<br\s*\/?>|<\/p>)/iu' => '$1',
    '/<strong>\s*영업시간\s*:\s*<\/strong>.*?(?:확인 필요|문의 필요).*?(<br\s*\/?>|<\/p>)/iu' => '$1',
  );

  foreach ($line_segment_patterns as $pattern => $replacement) {
    $html = preg_replace($pattern, $replacement, $html);
  }

  $block_removals = array(
    '/<p[^>]*>[\s\S]*?가능할\s*수\s*있(?:습니다|어요)[\s\S]*?<\/p>/iu',
    '/<li[^>]*>[\s\S]*?(?:확인 필요|문의 필요|방문 전 확인|방문 전 문의|직접 확인 필요|가게 직접 확인 필요)[\s\S]*?<\/li>/iu',
    '/<p[^>]*>\s*<strong>\s*(?:전화번호|전화|주차|예약)\s*:\s*<\/strong>[\s\S]*?<\/p>/iu',
    '/<p[^>]*>\s*<strong>\s*영업시간\s*:\s*<\/strong>[\s\S]*?(?:확인 필요|문의 필요)[\s\S]*?<\/p>/iu',
  );

  foreach ($block_removals as $pattern) {
    $html = preg_replace($pattern, '', $html);
  }

  $html = cleanup_uncertain_place_info_rows($html);
  $html = cleanup_uncertain_faq_blocks($html);
  $html = cleanup_review_analysis_sections($html);

  return cleanup_empty_html_blocks($html);
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
      if (preg_match('/(확인 필요|직접 확인|가게 직접 확인|문의 필요|방문 전 확인|문의하시는 것이 좋습니다|가능한 것으로 보이나|있을 수 있습니다|정보 부족)/u', $a)) {
        continue;
      }
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
      if (preg_match('/(확인 필요|직접 확인|가게 직접 확인|문의 필요|방문 전 확인|문의하시는 것이 좋습니다|가능한 것으로 보이나|있을 수 있습니다|정보 부족)/u', $a)) {
        continue;
      }
      if ((mb_strpos($q, '?') !== false || mb_strpos($q, '？') !== false) && mb_strlen($q) < 140 && mb_strlen($a) > 20) {
        $faq_items[] = array(
          '@type' => 'Question',
          'name' => $q,
          'acceptedAnswer' => array('@type' => 'Answer', 'text' => mb_substr($a, 0, 300)),
        );
      }
    }
  }

  if (empty($faq_items) && preg_match_all('/<p[^>]*>\s*<strong>\s*(Q[\d\s:.-]*.*?\?.*?)<\/strong>\s*<\/p>\s*<p[^>]*>(.*?)<\/p>/si', $html, $matches, PREG_SET_ORDER)) {
    foreach ($matches as $m) {
      $q = wp_strip_all_tags($m[1]);
      $a = wp_strip_all_tags($m[2]);
      if (preg_match('/(확인 필요|직접 확인|가게 직접 확인|문의 필요|방문 전 확인|문의하시는 것이 좋습니다|가능한 것으로 보이나|있을 수 있습니다|정보 부족)/u', $a)) {
        continue;
      }
      if (mb_strlen($q) < 140 && mb_strlen($a) > 20) {
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

  if ($telephone !== '' && is_placeholder_telephone($telephone)) {
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
  $content = cleanup_existing_post_language(
    improve_image_alts(strip_review_reference_markers($content_without_schemas), $title)
  );

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

  $terms = wp_get_post_terms($post->ID, 'post_tag');
  if (!is_wp_error($terms)) {
    $filtered_tag_ids = array();
    foreach ($terms as $term) {
      if (!is_review_keyword_tag($term->name ?? '')) {
        $filtered_tag_ids[] = (int) $term->term_id;
      }
    }
    wp_set_post_terms($post->ID, $filtered_tag_ids, 'post_tag', false);
  }

  $updated++;
  $faq_label = $faq_count > 0 ? " + FAQ({$faq_count})" : '';
  echo "  ✅ #{$post->ID} \"{$short}...\" — GEO{$faq_label} + Yoast\n";
}

echo "\nRESULT:{$updated}:{$skipped}:{$errors}\n";
